-- 0007: rest of Global Configuration (stakeholder update 2026-10-17).
-- Rotation replaces the assignment rules' plain round-robin and the 10-minute rule: each rule has shift days and
-- hours, a time zone, minutes before the lead rotates to the next agent, a maximum number of rotations and a
-- fallback (Admin, Unassigned or a chosen user). The leads.response_time setting is removed.
-- Dual Lead Ownership: a secondary owner per lead. Migration: lead imports can skip or update known leads.

ALTER TABLE assignment_rules
  ADD COLUMN shift_days smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}' CHECK (shift_days <@ '{0,1,2,3,4,5,6}'::smallint[] AND cardinality(shift_days) > 0), -- Days the rule works (0 = Sunday)
  ADD COLUMN shift_start time,                                     -- Shift start (empty = all day)
  ADD COLUMN shift_end time,                                       -- Shift end (empty = all day)
  ADD COLUMN timezone text,                                        -- Shift time zone (empty = company time zone)
  ADD COLUMN rotation_minutes smallint NOT NULL DEFAULT 10 CHECK (rotation_minutes BETWEEN 1 AND 1440), -- Minutes an agent has before the lead rotates
  ADD COLUMN max_rotations smallint NOT NULL DEFAULT 3 CHECK (max_rotations BETWEEN 0 AND 50), -- Rotations before the fallback
  ADD COLUMN fallback text NOT NULL DEFAULT 'admin' CHECK (fallback IN ('admin','unassigned','user')), -- Where the lead goes after the last rotation
  ADD COLUMN fallback_user_id uuid,                                -- Fallback user (fallback = user)
  ADD CONSTRAINT assignment_rules_shift_check CHECK ((shift_start IS NULL) = (shift_end IS NULL)),
  ADD CONSTRAINT assignment_rules_fallback_user_check CHECK (fallback <> 'user' OR fallback_user_id IS NOT NULL),
  ADD CONSTRAINT assignment_rules_fallback_user_fk FOREIGN KEY (tenant_id, fallback_user_id) REFERENCES users(tenant_id, id);

ALTER TABLE leads
  ADD COLUMN rotation_rule_id uuid,                                -- Rotation rule that assigned the lead (drives its rotation)
  ADD COLUMN rotation_count smallint NOT NULL DEFAULT 0 CHECK (rotation_count >= 0), -- Times the lead rotated to the next agent
  ADD COLUMN secondary_owner_user_id uuid,                         -- Secondary owner (Dual Lead Ownership)
  ADD CONSTRAINT leads_rotation_rule_fk FOREIGN KEY (tenant_id, rotation_rule_id) REFERENCES assignment_rules(tenant_id, id),
  ADD CONSTRAINT leads_secondary_owner_fk FOREIGN KEY (tenant_id, secondary_owner_user_id) REFERENCES users(tenant_id, id),
  ADD CONSTRAINT leads_secondary_owner_check CHECK (secondary_owner_user_id IS NULL OR secondary_owner_user_id IS DISTINCT FROM owner_user_id);
CREATE INDEX leads_secondary_owner_idx ON leads (tenant_id, secondary_owner_user_id) WHERE secondary_owner_user_id IS NOT NULL;

ALTER TABLE lead_imports
  ADD COLUMN duplicate_mode text NOT NULL DEFAULT 're_enquiry' CHECK (duplicate_mode IN ('re_enquiry','skip','update')), -- Known phone or email: re-enquiry (lead import), skip or update (migration)
  ADD COLUMN rows_updated integer NOT NULL DEFAULT 0 CHECK (rows_updated >= 0), -- Existing leads updated (duplicate_mode = update)
  ADD COLUMN rows_skipped integer NOT NULL DEFAULT 0 CHECK (rows_skipped >= 0), -- Existing leads left as they were (duplicate_mode = skip)
  ADD COLUMN attempts smallint NOT NULL DEFAULT 1 CHECK (attempts >= 1); -- Runs of this batch (a retry never creates duplicates)

DELETE FROM tenant_settings WHERE key = 'leads.response_time';

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
   ('director','leads.view'),('director','leads.create'),('director','leads.edit'),('director','leads.delete'),('director','leads.assign'),('director','leads.share'),('director','leads.import'),('director','messages.send'),('director','campaigns.create'),('director','campaigns.approve'),('director','projects.manage'),('director','units.change_status'),('director','finance.create'),('director','finance.approve'),('director','attendance.view'),('director','attendance.approve'),('director','users.manage'),('director','settings.manage'),('director','audit.view'),('director','billing.view'),
   ('general_manager','leads.view'),('general_manager','leads.create'),('general_manager','leads.edit'),('general_manager','leads.delete'),('general_manager','leads.assign'),('general_manager','leads.share'),('general_manager','leads.import'),('general_manager','messages.send'),('general_manager','campaigns.create'),('general_manager','campaigns.approve'),('general_manager','projects.manage'),('general_manager','units.change_status'),('general_manager','attendance.view'),('general_manager','attendance.approve'),
   ('sales_manager','leads.view'),('sales_manager','leads.create'),('sales_manager','leads.edit'),('sales_manager','leads.delete'),('sales_manager','leads.assign'),('sales_manager','leads.share'),('sales_manager','leads.import'),('sales_manager','messages.send'),('sales_manager','campaigns.create'),('sales_manager','units.change_status'),('sales_manager','attendance.view'),('sales_manager','attendance.approve'),
   ('team_leader','leads.view'),('team_leader','leads.create'),('team_leader','leads.edit'),('team_leader','leads.assign'),('team_leader','leads.share'),('team_leader','messages.send'),('team_leader','attendance.view'),('team_leader','attendance.approve'),
   ('sales_agent','leads.view'),('sales_agent','leads.create'),('sales_agent','leads.edit'),('sales_agent','leads.share'),('sales_agent','messages.send'),('sales_agent','attendance.view'),
   ('admin','leads.view'),('admin','leads.create'),('admin','leads.edit'),('admin','leads.delete'),('admin','leads.assign'),('admin','leads.share'),('admin','leads.import'),('admin','leads.export'),('admin','reports.export'),('admin','attendance.export'),('admin','projects.manage'),('admin','units.change_status'),('admin','attendance.view'),('admin','attendance.approve'),('admin','users.manage'),('admin','users.lead_assignment'),('admin','settings.manage'),('admin','audit.view'),('admin','billing.view'),('admin','billing.manage'),
   ('finance','finance.create'),('finance','finance.approve')
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
