-- 0006: four fixed lead statuses with substatuses (stakeholder update 2026-10-17, "Global Configuration › Manage Status").
-- Hot, Warm, Cold and Sale Done replace the 15 lead stages. Only the Admin manages substatuses. New leads start as Warm.
-- Existing leads move: Won → Sale Done; Lost → Cold / Not Interested; Invalid → Cold / Invalid / Out of Service;
-- Hot, Qualified, Meeting, Viewing, EOI, Booked → Hot; No Response → Warm / No Response / Call Back; the rest → Warm.
-- Status history keeps every change, pointed at the new statuses. Cold is a closed status: it needs a substatus, not a reason.

ALTER TABLE lead_stages
  ADD COLUMN color text NOT NULL DEFAULT '#64748b' CHECK (color ~ '^#[0-9a-fA-F]{6}$'), -- Badge colour
  ADD COLUMN description text,                                     -- Shown in Manage Status
  ADD COLUMN requires_scheduling boolean NOT NULL DEFAULT false;   -- Moving a lead here needs a date and time

--- table lead_substatuses | Lead settings | Substatuses under the four lead statuses; only the Admin adds, renames, orders or turns them off.
CREATE TABLE lead_substatuses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Substatus ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  stage_id        uuid NOT NULL,                                   -- Parent status (Hot, Warm, Cold, Sale Done)
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100), -- Display name
  sort_order      smallint NOT NULL,                               -- Order under the status
  is_active       boolean NOT NULL DEFAULT true,                   -- Active flag (inactive ones stay on old leads)
  requires_scheduling boolean NOT NULL DEFAULT false,              -- Choosing it needs a date and time
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, stage_id),
  FOREIGN KEY (tenant_id, stage_id) REFERENCES lead_stages(tenant_id, id)
);
CREATE UNIQUE INDEX lead_substatuses_name_uq ON lead_substatuses (tenant_id, stage_id, lower(name));
CREATE INDEX lead_substatuses_stage_idx ON lead_substatuses (tenant_id, stage_id, sort_order);
ALTER TABLE lead_substatuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_substatuses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lead_substatuses USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE TRIGGER lead_substatuses_updated_at BEFORE UPDATE ON lead_substatuses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON lead_substatuses TO crm_app, crm_worker;
GRANT SELECT ON lead_substatuses TO crm_readonly;

ALTER TABLE leads ADD COLUMN substatus_id uuid;                   -- Substatus under the current status
ALTER TABLE leads ADD CONSTRAINT leads_substatus_fk FOREIGN KEY (tenant_id, substatus_id, stage_id) REFERENCES lead_substatuses(tenant_id, id, stage_id);
ALTER TABLE lead_stage_history ADD COLUMN to_substatus_id uuid;   -- Substatus chosen with the change
ALTER TABLE lead_stage_history ADD CONSTRAINT lead_stage_history_substatus_fk FOREIGN KEY (tenant_id, to_substatus_id) REFERENCES lead_substatuses(tenant_id, id);

-- The four fixed lead statuses and their default substatuses (stakeholder update 2026-10-17). Safe to run again.
CREATE OR REPLACE FUNCTION seed_lead_statuses(p_tenant uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  INSERT INTO lead_stages (tenant_id, key, name, category, sort_order, is_system, color, description, requires_scheduling) VALUES
   (p_tenant,'hot','Hot','open',1,true,'#e11d48','Ready to buy soon: calls, Zoom and viewings scheduled',true),
   (p_tenant,'warm','Warm','open',2,true,'#f59e0b','Interested, being followed up',true),
   (p_tenant,'cold','Cold','lost',3,true,'#0284c7','Not interested, not reachable or not genuine',false),
   (p_tenant,'sale_done','Sale Done','won',4,true,'#059669','Purchase completed',false)
  ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, is_system = true, is_active = true,
    color = EXCLUDED.color, description = EXCLUDED.description, requires_scheduling = EXCLUDED.requires_scheduling;
  INSERT INTO lead_substatuses (tenant_id, stage_id, name, sort_order, requires_scheduling)
  SELECT p_tenant, s.id, v.name, v.ord, v.sched
  FROM (VALUES
    ('hot','Zoom Schedule',1,true),('hot','Event Attended',2,false),('hot','Zoom Done',3,false),('hot','Viewing Schedule',4,true),
    ('hot','Potential Buyer',5,false),('hot','Immediate Buyer',6,false),
    ('warm','Channel Partner',1,false),('warm','Attend Event',2,true),('warm','Future Interested',3,false),('warm','Interested',4,false),
    ('warm','No Response / Call Back',5,true),
    ('cold','Fake',1,false),('cold','Not Interested',2,false),('cold','Invalid / Out of Service',3,false),('cold','Time Mismatch',4,false),
    ('cold','Language Barrier',5,false),('cold','No Response',6,false),('cold','Declined / Busy',7,false)
  ) AS v(stage_key, name, ord, sched)
  JOIN lead_stages s ON s.tenant_id = p_tenant AND s.key = v.stage_key
  WHERE NOT EXISTS (SELECT 1 FROM lead_substatuses x WHERE x.tenant_id = p_tenant AND x.stage_id = s.id AND lower(x.name) = lower(v.name));
END $$;

DO $$
DECLARE t uuid; c text;
BEGIN
  CREATE TEMP TABLE stage_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL, new_category text NOT NULL, new_sub uuid) ON COMMIT DROP;
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    UPDATE lead_stages SET key = 'sale_done' WHERE tenant_id = t AND key = 'won'
      AND NOT EXISTS (SELECT 1 FROM lead_stages WHERE tenant_id = t AND key = 'sale_done');
    PERFORM seed_lead_statuses(t);
    TRUNCATE stage_map;
    INSERT INTO stage_map
    SELECT s.id, n.id, n.category,
           (SELECT x.id FROM lead_substatuses x WHERE x.tenant_id = t AND x.stage_id = n.id AND x.name = CASE s.key
              WHEN 'lost' THEN 'Not Interested' WHEN 'invalid' THEN 'Invalid / Out of Service'
              WHEN 'no_response' THEN 'No Response / Call Back' END)
    FROM lead_stages s
    JOIN lead_stages n ON n.tenant_id = t AND n.key = CASE
      WHEN s.category = 'won' THEN 'sale_done'
      WHEN s.category IN ('lost','invalid') THEN 'cold'
      WHEN s.key IN ('qualified','meeting_scheduled','viewing_scheduled','eoi_submitted','booked') THEN 'hot'
      ELSE 'warm' END
    WHERE s.tenant_id = t AND s.key NOT IN ('hot','warm','cold','sale_done');

    UPDATE leads l SET stage_id = m.new_id, stage_category = m.new_category, substatus_id = m.new_sub
      FROM stage_map m WHERE l.tenant_id = t AND l.stage_id = m.old_id;
    UPDATE lead_stage_history h SET to_stage_id = m.new_id, to_substatus_id = m.new_sub FROM stage_map m WHERE h.tenant_id = t AND h.to_stage_id = m.old_id;
    UPDATE lead_stage_history h SET from_stage_id = m.new_id FROM stage_map m WHERE h.tenant_id = t AND h.from_stage_id = m.old_id;
    DELETE FROM lead_stages WHERE tenant_id = t AND key NOT IN ('hot','warm','cold','sale_done');
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);

  -- Closed leads (Cold) need a substatus instead of a Lost / Invalid reason.
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'leads'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%close_reason_id IS NOT NULL%' LOOP
    EXECUTE format('ALTER TABLE leads DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE leads ADD CONSTRAINT leads_closed_substatus_check CHECK (stage_category NOT IN ('lost','invalid') OR substatus_id IS NOT NULL);

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
   (p_tenant,'leads.response_time','{"minutes":10,"next_agent_scope":"team","fallback":"admin"}'),
   (p_tenant,'leads.scoring','{"budget_fit":30,"project_match":20,"source_quality":20,"engagement":30}');
END $$;
