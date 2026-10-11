-- =====================================================================
-- Security: roles, row-level security, append-only history, triggers
-- Run after schema.sql (as the database owner).
-- =====================================================================

-- Application roles (passwords are set by Terraform, not here)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN CREATE ROLE crm_app LOGIN; END IF;      -- api: one tenant per transaction
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_worker') THEN CREATE ROLE crm_worker LOGIN BYPASSRLS; END IF; -- worker: cross-tenant scheduled jobs
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_readonly') THEN CREATE ROLE crm_readonly LOGIN; END IF; -- support / reporting
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_platform') THEN CREATE ROLE crm_platform LOGIN BYPASSRLS; END IF; -- owner console and Stripe webhooks only
END $$;

GRANT USAGE ON SCHEMA public TO crm_app, crm_worker, crm_readonly, crm_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app, crm_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO crm_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_platform;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO crm_platform;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO crm_app, crm_worker;
REVOKE INSERT, UPDATE, DELETE ON currencies, permissions FROM crm_app;

-- Platform (owner console) data: tenants' users can read plans only; the rest is invisible to the app
REVOKE ALL ON platform_admins, platform_settings, platform_audit_logs FROM crm_app, crm_readonly;
REVOKE INSERT, UPDATE, DELETE ON plans FROM crm_app, crm_worker;
REVOKE SELECT, UPDATE, DELETE ON sales_enquiries FROM crm_app;     -- public "talk to sales" form may only insert
GRANT SELECT ON platform_settings TO crm_worker;
-- Billing records are written only by the platform (Stripe webhooks, owner console) and the worker (renewals)
REVOKE INSERT, UPDATE, DELETE ON billing_invoices, billing_invoice_lines, billing_payments, tenant_usage_daily FROM crm_app;
-- Tenants can't change their own verification or platform status
REVOKE UPDATE ON tenants FROM crm_app;
GRANT UPDATE (name, legal_name, trade_license_no, rera_orn, rera_brn, trn, email, phone, address, website, logo_file_id, trade_license_file_id, timezone, base_currency, updated_at) ON tenants TO crm_app;
-- Subscriptions: the app changes seats, cycle, payment method and cancellation; status changes come from the platform / worker
REVOKE UPDATE ON subscriptions FROM crm_app;
GRANT UPDATE (seats, billing_cycle, payment_method, cancel_at_period_end, updated_at) ON subscriptions TO crm_app;

-- Append-only history: no UPDATE / DELETE for the application
REVOKE UPDATE, DELETE ON audit_logs, lead_stage_history, lead_assignments, finance_document_events, unit_changes, subscription_events FROM crm_app, crm_worker;
REVOKE UPDATE, DELETE ON subscription_events, platform_audit_logs FROM crm_platform;
-- Enquiries, consents and timeline entries are never changed or deleted
REVOKE UPDATE, DELETE ON lead_inquiries, consents, activities FROM crm_app, crm_worker;

-- Current tenant for the transaction: SET LOCAL app.tenant_id = '<uuid>'
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- Row-level security on every table that has tenant_id
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables x ON x.table_name = c.table_name AND x.table_schema = c.table_schema AND x.table_type = 'BASE TABLE'
           WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants USING (id = current_tenant_id()) WITH CHECK (id = current_tenant_id());

-- updated_at maintained automatically
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'updated_at'
             AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema='public') LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_updated_at', t);
  END LOOP;
END $$;

-- Financial document lines may change only while the document is Draft
CREATE OR REPLACE FUNCTION guard_draft_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM finance_documents WHERE id = COALESCE(NEW.document_id, OLD.document_id);
  IF st IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Document lines can only change while the document is draft (status: %)', st USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER finance_document_lines_draft_only BEFORE INSERT OR UPDATE OR DELETE ON finance_document_lines
  FOR EACH ROW EXECUTE FUNCTION guard_draft_lines();

-- Amounts and parties of a financial document are frozen after approval
CREATE OR REPLACE FUNCTION guard_approved_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.subtotal, NEW.tax_total, NEW.currency, NEW.counterparty_id, NEW.issue_date, NEW.doc_type, NEW.number)
       IS DISTINCT FROM (OLD.subtotal, OLD.tax_total, OLD.currency, OLD.counterparty_id, OLD.issue_date, OLD.doc_type, OLD.number) THEN
    RAISE EXCEPTION 'Approved documents cannot be edited; cancel and reissue' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_documents_frozen BEFORE UPDATE ON finance_documents
  FOR EACH ROW EXECUTE FUNCTION guard_approved_document();

-- Active users can never exceed the paid seats
CREATE OR REPLACE FUNCTION guard_seats() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer; lim integer;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN RETURN NEW; END IF;
  SELECT seats INTO lim FROM subscriptions WHERE tenant_id = NEW.tenant_id;
  IF lim IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO n FROM users WHERE tenant_id = NEW.tenant_id AND status = 'active' AND id <> NEW.id;
  IF n + 1 > lim THEN
    RAISE EXCEPTION 'Seat limit reached (% of % seats used); add seats first', n, lim USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_seat_limit BEFORE INSERT OR UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION guard_seats();

-- Seats cannot be reduced below the number of active users
CREATE OR REPLACE FUNCTION guard_seat_reduction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  IF NEW.seats < OLD.seats THEN
    SELECT count(*) INTO n FROM users WHERE tenant_id = NEW.tenant_id AND status = 'active';
    IF NEW.seats < n THEN
      RAISE EXCEPTION 'Cannot reduce seats to % while % users are active; deactivate users first', NEW.seats, n USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER subscriptions_seat_reduction BEFORE UPDATE OF seats ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION guard_seat_reduction();

-- Paid subscription invoices are frozen
CREATE OR REPLACE FUNCTION guard_billing_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.subtotal, NEW.vat_rate, NEW.vat_amount, NEW.number, NEW.period_start, NEW.period_end, NEW.customer_legal_name, NEW.customer_trn)
     IS DISTINCT FROM (OLD.subtotal, OLD.vat_rate, OLD.vat_amount, OLD.number, OLD.period_start, OLD.period_end, OLD.customer_legal_name, OLD.customer_trn) THEN
    RAISE EXCEPTION 'Issued subscription invoices cannot be edited; void and reissue' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_invoices_frozen BEFORE UPDATE ON billing_invoices
  FOR EACH ROW EXECUTE FUNCTION guard_billing_invoice();
