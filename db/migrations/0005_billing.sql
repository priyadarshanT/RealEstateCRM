-- 0005: storage the sign-up and billing rules need (SRS §12; API guide §10a).

-- Sign-ups in progress: the email code (6 digits, 5 tries, 15 minutes) and the Stripe card setup, before the company exists.
CREATE TABLE signups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Sign-up ID
  tenant_type     text NOT NULL CHECK (tenant_type IN ('brokerage','individual')), -- Brokerage (B2B) or individual agent (B2C)
  company_name    text NOT NULL,                                   -- Company or agent name
  trade_license_no text,                                           -- Trade licence (brokerage)
  rera_orn        text,                                            -- RERA office number (brokerage)
  rera_brn        text,                                            -- RERA broker card (individual)
  admin_full_name text NOT NULL,                                   -- First Admin
  admin_email     citext NOT NULL,                                 -- First Admin's login email
  admin_phone     text NOT NULL CHECK (admin_phone ~ '^\+[1-9][0-9]{6,14}$'), -- First Admin's phone
  plan_id         uuid NOT NULL REFERENCES plans(id),              -- Chosen plan
  seats           integer NOT NULL CHECK (seats >= 1),             -- Paid users
  billing_cycle   text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')), -- Billing cycle
  code_hash       text NOT NULL,                                   -- SHA-256 of the emailed 6-digit code
  code_expires_at timestamptz NOT NULL,                            -- Code valid until (15 minutes)
  code_attempts   smallint NOT NULL DEFAULT 0,                     -- Wrong tries (max 5)
  code_sent_at    timestamptz NOT NULL DEFAULT now(),              -- Last code email (resend at most once a minute)
  email_verified_at timestamptz,                                   -- Email confirmed
  stripe_customer_id text,                                         -- Stripe customer
  stripe_setup_intent_id text,                                     -- Stripe card setup
  tenant_id       uuid REFERENCES tenants(id),                     -- Company created on completion
  ip_address      inet,                                            -- Where the sign-up came from
  expires_at      timestamptz NOT NULL,                            -- Sign-up abandoned after this time
  completed_at    timestamptz,                                     -- Completed time
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Started time
  CHECK (tenant_type <> 'brokerage' OR (trade_license_no IS NOT NULL AND rera_orn IS NOT NULL)),
  CHECK (tenant_type <> 'individual' OR rera_brn IS NOT NULL),
  CHECK ((completed_at IS NULL) = (tenant_id IS NULL))
);
CREATE INDEX signups_email_idx ON signups (admin_email) WHERE completed_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON signups TO crm_app, crm_platform;
GRANT SELECT ON signups TO crm_worker, crm_readonly;

-- Changes that take effect at the next renewal (fewer seats, plan downgrade, switch to monthly).
ALTER TABLE subscriptions
  ADD COLUMN scheduled_seats integer CHECK (scheduled_seats IS NULL OR scheduled_seats >= 1),
  ADD COLUMN scheduled_plan_id uuid REFERENCES plans(id),
  ADD COLUMN scheduled_billing_cycle text CHECK (scheduled_billing_cycle IN ('monthly','yearly'));
COMMENT ON COLUMN subscriptions.scheduled_seats IS 'Fewer seats from the next renewal';
COMMENT ON COLUMN subscriptions.scheduled_plan_id IS 'Downgrade from the next renewal';
COMMENT ON COLUMN subscriptions.scheduled_billing_cycle IS 'Switch to monthly from the next renewal';
GRANT UPDATE (scheduled_seats, scheduled_plan_id, scheduled_billing_cycle) ON subscriptions TO crm_app;

-- Tax invoice numbers CRM-YYYY-NNNNNN (one series for the whole platform).
CREATE SEQUENCE billing_invoice_number_seq;
GRANT USAGE ON SEQUENCE billing_invoice_number_seq TO crm_platform, crm_worker;

-- A cancelled company's data is deleted 90 days after its subscription ended (SRS §12, §14 Privacy).
-- Runs as the owner: append-only history and the draft/approved document guards are switched off for this delete only.
CREATE OR REPLACE FUNCTION delete_tenant_data(p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM subscriptions WHERE tenant_id = p_tenant AND status = 'canceled' AND data_delete_after < current_date) THEN
    RAISE EXCEPTION 'Tenant % is not due for deletion', p_tenant;
  END IF;
  SET LOCAL session_replication_role = replica;
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables x ON x.table_name = c.table_name AND x.table_schema = c.table_schema AND x.table_type = 'BASE TABLE'
           WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' LOOP
    EXECUTE format('DELETE FROM %I WHERE tenant_id = $1', t) USING p_tenant;
  END LOOP;
  UPDATE sales_enquiries SET tenant_id = NULL WHERE tenant_id = p_tenant;
  DELETE FROM tenants WHERE id = p_tenant;
  INSERT INTO platform_audit_logs (action, entity_type, entity_id, changes) VALUES ('tenant.data_deleted', 'tenants', p_tenant, NULL);
END $$;
REVOKE ALL ON FUNCTION delete_tenant_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_tenant_data(uuid) TO crm_worker;
