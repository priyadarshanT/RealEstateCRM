-- Global reference data
INSERT INTO currencies (code, name, decimals) VALUES
 ('AED','UAE Dirham',2),('USD','US Dollar',2),('EUR','Euro',2),('GBP','Pound Sterling',2),
 ('SAR','Saudi Riyal',2),('INR','Indian Rupee',2),('RUB','Russian Ruble',2),('CNY','Chinese Yuan',2)
ON CONFLICT DO NOTHING;

INSERT INTO permissions (key, module, description) VALUES
 ('leads.view','leads','View leads within the role scope'),
 ('leads.create','leads','Create leads'),
 ('leads.edit','leads','Edit leads'),
 ('leads.delete','leads','Delete and restore leads'),
 ('leads.assign','leads','Assign and reassign leads'),
 ('leads.share','leads','Share a lead with other users'),
 ('leads.import','leads','Import leads from Excel / CSV'),
 ('leads.export','leads','Export lead data'),
 ('reports.export','reports','Export reports'),
 ('attendance.export','attendance','Export attendance'),
 ('messages.send','messaging','Send one-to-one WhatsApp and email'),
 ('campaigns.create','messaging','Create bulk campaigns'),
 ('campaigns.approve','messaging','Approve bulk campaigns'),
 ('projects.manage','projects','Create and edit developers, projects, buildings and units'),
 ('projects.export','projects','Export projects to Excel (separate from lead export)'),
 ('units.change_status','projects','Change unit status and price'),
 ('finance.create','finance','Create invoices and purchase orders'),
 ('finance.approve','finance','Approve and cancel invoices and purchase orders'),
 ('attendance.view','attendance','View attendance within the role scope'),
 ('attendance.approve','attendance','Approve attendance corrections and leave'),
 ('users.manage','organization','Manage users, roles and teams'),
 ('users.lead_assignment','organization','Turn lead assignment on or off for a user'),
 ('settings.manage','settings','Change settings and integrations'),
 ('audit.view','audit','View the audit log'),
 ('billing.view','billing','View plan, seats and subscription invoices'),
 ('billing.manage','billing','Change plan, seats, payment method and cancel the subscription')
ON CONFLICT DO NOTHING;

-- Plans (prices excluding VAT; change in the owner console)
INSERT INTO plans (key, name, description, tenant_type, price_monthly, price_yearly, min_seats, max_seats, self_service, sort_order) VALUES
 ('solo','Solo','For one independent agent','individual',99,990,1,1,true,1),
 ('team','Team','For brokerages of any size','brokerage',99,990,1,NULL,true,2),
 ('enterprise','Enterprise','Custom price, priority support and custom setup','brokerage',99,990,1,NULL,false,3)
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value) VALUES
 ('billing.trial','{"days":14,"card_required":true}'),
 ('billing.grace','{"days":14,"then":"read_only"}'),
 ('billing.retention','{"days_after_cancel":90,"export_available":true}'),
 ('billing.vat','{"rate":5,"prices_include_vat":false}'),
 ('billing.refunds','{"policy":"no_refund_for_started_period"}'),
 ('billing.payment_methods','{"card":true,"bank_transfer":true,"gateway":"stripe"}'),
 ('signup.verification','{"brokerage":["trade_license_no","rera_orn"],"individual":["rera_brn"]}')
ON CONFLICT (key) DO NOTHING;

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
   ('admin','leads.view'),('admin','leads.create'),('admin','leads.edit'),('admin','leads.delete'),('admin','leads.assign'),('admin','leads.share'),('admin','leads.import'),('admin','leads.export'),('admin','reports.export'),('admin','attendance.export'),('admin','projects.manage'),('admin','projects.export'),('admin','units.change_status'),('admin','attendance.view'),('admin','attendance.approve'),('admin','users.manage'),('admin','users.lead_assignment'),('admin','settings.manage'),('admin','audit.view'),('admin','billing.view'),('admin','billing.manage'),
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
