-- Test data: two tenants (A, B)
INSERT INTO tenants (id, type, name, trade_license_no, rera_orn) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','brokerage','Al Noor Realty','TL-1001','ORN-1001'),
 ('bbbbbbbb-0000-0000-0000-000000000001','brokerage','Other Brokerage','TL-2002','ORN-2002');
SELECT create_tenant_defaults('aaaaaaaa-0000-0000-0000-000000000001');
SELECT create_tenant_defaults('bbbbbbbb-0000-0000-0000-000000000001');
INSERT INTO users (id, tenant_id, email, full_name, role_id, status)
SELECT v.id::uuid, v.t::uuid, v.e, v.n, r.id, 'active' FROM (VALUES
 ('a0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','admin@a.ae','Admin A','admin'),
 ('a0000000-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000001','sara@a.ae','Sara','team_leader'),
 ('a0000000-0000-0000-0000-00000000000c','aaaaaaaa-0000-0000-0000-000000000001','ali@a.ae','Ali','sales_agent'),
 ('a0000000-0000-0000-0000-00000000000d','aaaaaaaa-0000-0000-0000-000000000001','mira@a.ae','Mira','sales_agent'),
 ('b0000000-0000-0000-0000-00000000000a','bbbbbbbb-0000-0000-0000-000000000001','admin@b.ae','Admin B','admin')
) v(id,t,e,n,rk) JOIN roles r ON r.tenant_id = v.t::uuid AND r.key = v.rk;
INSERT INTO lead_sources (id, tenant_id, type, name) VALUES
 ('a1000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','meta','Meta'),
 ('b1000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','meta','Meta');
INSERT INTO leads (id, tenant_id, full_name, phone_primary, source_id, stage_id, stage_category, owner_user_id, assigned_at, next_follow_up_at)
SELECT 'a2000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Ahmed','+971501234567','a1000000-0000-0000-0000-000000000001', s.id, 'open','a0000000-0000-0000-0000-00000000000c', now(), now()+interval '1 day'
FROM lead_stages s WHERE s.tenant_id='aaaaaaaa-0000-0000-0000-000000000001' AND s.key='warm';
INSERT INTO leads (id, tenant_id, full_name, phone_primary, source_id, stage_id, stage_category)
SELECT 'b2000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Other lead','+971509999999','b1000000-0000-0000-0000-000000000001', s.id, 'open'
FROM lead_stages s WHERE s.tenant_id='bbbbbbbb-0000-0000-0000-000000000001' AND s.key='warm';
INSERT INTO lead_inquiries (tenant_id, lead_id, source_id, external_submission_id, form_answers, submitted_at)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','META-123','{"budget":"3M"}', now());
INSERT INTO developers (id, tenant_id, name) VALUES ('a3000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Emaar');
INSERT INTO projects (id, tenant_id, developer_id, name) VALUES
 ('a4000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','Beachfront'),
 ('a4000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','Dubai Hills');
INSERT INTO units (id, tenant_id, project_id, unit_number, property_type, bedrooms, size_sqft, price) VALUES
 ('a5000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','1204','apartment',2,1280,3250000);
INSERT INTO counterparties (id, tenant_id, type, name, developer_id) VALUES ('a6000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','developer','Emaar','a3000000-0000-0000-0000-000000000001');
INSERT INTO finance_documents (id, tenant_id, doc_type, counterparty_id, issue_date, currency, created_by)
VALUES ('a7000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','sales_invoice','a6000000-0000-0000-0000-000000000001', current_date, 'AED','a0000000-0000-0000-0000-00000000000a');
INSERT INTO finance_document_lines (tenant_id, document_id, line_no, description, quantity, unit_price, tax_rate, line_subtotal, tax_amount)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001',1,'Commission 2%',1,65000,5,65000,3250);
UPDATE finance_documents SET subtotal=65000, tax_total=3250 WHERE id='a7000000-0000-0000-0000-000000000001';
INSERT INTO leave_types (id, tenant_id, name) VALUES ('a8000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Annual');
INSERT INTO platform_admins (id, email, full_name, role) VALUES ('f0000000-0000-0000-0000-000000000001','owner@crm.ae','Owner','owner');
INSERT INTO subscriptions (id, tenant_id, plan_id, status, seats, price_per_seat, card_on_file, current_period_start, current_period_end)
SELECT 'ab000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001', id, 'active', 4, 99, true, '2026-10-01', '2026-11-01' FROM plans WHERE key='team';
INSERT INTO billing_invoices (id, tenant_id, subscription_id, number, period_start, period_end, due_date, subtotal, vat_amount, customer_legal_name)
VALUES ('ac000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','CRM-2026-000001','2026-10-01','2026-10-31', current_date+7, 396, 19.80, 'Al Noor Realty LLC');
GRANT crm_app TO CURRENT_USER;
GRANT crm_platform TO CURRENT_USER;
