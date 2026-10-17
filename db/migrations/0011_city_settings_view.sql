-- 0011: stakeholder update 2026-10-17 (lead page follow-up).
-- 1. Global Configuration: every user can view it; only the Admin changes it (new permission settings.view for all
--    roles; the Director no longer has settings.manage by default).
-- 2. City is recorded on leads (free text) and exported as its own column.
-- 3. Assignment history (from, to, by, when) is shown on the lead; lead_assignments already records it.

ALTER TABLE leads ADD COLUMN city text CHECK (city IS NULL OR length(btrim(city)) BETWEEN 1 AND 100); -- City (free text)

INSERT INTO permissions (key, module, description) VALUES
 ('settings.view','settings','View Global Configuration (read only)')
ON CONFLICT (key) DO NOTHING;
DO $$ DECLARE t uuid; BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    INSERT INTO role_permissions (tenant_id, role_id, permission_key)
    SELECT t, r.id, 'settings.view' FROM roles r WHERE r.tenant_id = t
    ON CONFLICT DO NOTHING;
    DELETE FROM role_permissions rp USING roles r
     WHERE rp.role_id = r.id AND rp.tenant_id = t AND r.tenant_id = t AND r.key = 'director' AND r.is_system AND rp.permission_key = 'settings.manage';
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;

-- Creates the default roles, permissions, lead statuses and reasons for a new tenant
CREATE OR REPLACE FUNCTION create_tenant_defaults(p_tenant uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  INSERT INTO roles (tenant_id, key, name, data_scope, is_system) VALUES
   (p_tenant,'director','Director','company',true),
   (p_tenant,'general_manager','General Manager','division',true),
   (p_tenant,'sales_manager','Sales Manager','team',true),
   (p_tenant,'team_leader','Team Leader','team',true),
   (p_tenant,'sales_agent','Sales Agent','own',true),
   (p_tenant,'admin','Admin','company',true),
   (p_tenant,'finance','Finance','company',true);

  INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT p_tenant, r.id, p.key FROM roles r JOIN (VALUES
   ('director','leads.view'),('director','leads.create'),('director','leads.edit'),('director','leads.delete'),('director','leads.assign'),('director','leads.share'),('director','leads.import'),('director','messages.send'),('director','campaigns.create'),('director','campaigns.approve'),('director','projects.manage'),('director','units.change_status'),('director','finance.create'),('director','finance.approve'),('director','attendance.view'),('director','attendance.approve'),('director','users.manage'),('director','audit.view'),('director','billing.view'),
   ('general_manager','leads.view'),('general_manager','leads.create'),('general_manager','leads.edit'),('general_manager','leads.delete'),('general_manager','leads.assign'),('general_manager','leads.share'),('general_manager','leads.import'),('general_manager','messages.send'),('general_manager','campaigns.create'),('general_manager','campaigns.approve'),('general_manager','projects.manage'),('general_manager','units.change_status'),('general_manager','attendance.view'),('general_manager','attendance.approve'),
   ('sales_manager','leads.view'),('sales_manager','leads.create'),('sales_manager','leads.edit'),('sales_manager','leads.delete'),('sales_manager','leads.assign'),('sales_manager','leads.share'),('sales_manager','leads.import'),('sales_manager','messages.send'),('sales_manager','campaigns.create'),('sales_manager','units.change_status'),('sales_manager','attendance.view'),('sales_manager','attendance.approve'),
   ('team_leader','leads.view'),('team_leader','leads.create'),('team_leader','leads.edit'),('team_leader','leads.assign'),('team_leader','leads.share'),('team_leader','messages.send'),('team_leader','attendance.view'),('team_leader','attendance.approve'),
   ('sales_agent','leads.view'),('sales_agent','leads.create'),('sales_agent','leads.edit'),('sales_agent','leads.share'),('sales_agent','messages.send'),('sales_agent','attendance.view'),
   ('admin','leads.view'),('admin','leads.create'),('admin','leads.edit'),('admin','leads.delete'),('admin','leads.assign'),('admin','leads.share'),('admin','leads.import'),('admin','leads.export'),('admin','reports.export'),('admin','attendance.export'),('admin','projects.manage'),('admin','projects.export'),('admin','units.change_status'),('admin','attendance.view'),('admin','attendance.approve'),('admin','users.manage'),('admin','users.lead_assignment'),('admin','settings.manage'),('admin','audit.view'),('admin','billing.view'),('admin','billing.manage'),
   ('finance','finance.create'),('finance','finance.approve'),
   ('director','settings.view'),('general_manager','settings.view'),('sales_manager','settings.view'),('team_leader','settings.view'),('sales_agent','settings.view'),('admin','settings.view'),('finance','settings.view')
  ) AS g(role_key, perm) ON g.role_key = r.key JOIN permissions p ON p.key = g.perm
  WHERE r.tenant_id = p_tenant;

  PERFORM seed_lead_statuses(p_tenant);

  INSERT INTO reasons (tenant_id, type, key, name) VALUES
   (p_tenant,'reassignment',NULL,'Agent unavailable'),(p_tenant,'reassignment',NULL,'Language match'),
   (p_tenant,'reassignment','no_response','No response from agent'),(p_tenant,'reassignment','admin_fallback','Whole team did not respond');

  INSERT INTO lead_sources (tenant_id, type, name, quality_score) VALUES
   (p_tenant,'manual','Manual entry',50),(p_tenant,'import','Excel / CSV import',40);
  INSERT INTO tenant_currencies (tenant_id, currency) VALUES (p_tenant,'AED');
  INSERT INTO tenant_settings (tenant_id, key, value) VALUES
   (p_tenant,'leads.scoring','{"budget_fit":30,"project_match":20,"source_quality":20,"engagement":30}');
END $$;
