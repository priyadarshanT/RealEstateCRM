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

-- Creates the default roles, permissions, stages and reasons for a new tenant
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

  INSERT INTO lead_stages (tenant_id, key, name, category, sort_order, is_system) VALUES
   (p_tenant,'new','New','open',1,true),(p_tenant,'pending','Pending','open',2,true),(p_tenant,'attempted','Attempted','open',3,true),
   (p_tenant,'no_response','No Response','open',4,true),(p_tenant,'follow_up','Follow-up','open',5,true),(p_tenant,'warm','Warm','open',6,false),
   (p_tenant,'hot','Hot','open',7,false),(p_tenant,'qualified','Qualified','open',8,true),(p_tenant,'meeting_scheduled','Meeting Scheduled','open',9,true),
   (p_tenant,'viewing_scheduled','Viewing Scheduled','open',10,true),(p_tenant,'eoi_submitted','EOI Submitted','open',11,true),(p_tenant,'booked','Booked','open',12,true),
   (p_tenant,'won','Won','won',13,true),(p_tenant,'lost','Lost','lost',14,true),(p_tenant,'invalid','Invalid','invalid',15,true);

  INSERT INTO reasons (tenant_id, type, key, name) VALUES
   (p_tenant,'lost',NULL,'Budget too low'),(p_tenant,'lost',NULL,'Bought elsewhere'),
   (p_tenant,'lost',NULL,'Not interested'),(p_tenant,'invalid',NULL,'Wrong number'),(p_tenant,'invalid',NULL,'Fake / spam'),
   (p_tenant,'invalid',NULL,'Agent / broker'),(p_tenant,'reassignment',NULL,'Agent unavailable'),(p_tenant,'reassignment',NULL,'Language match'),
   (p_tenant,'reassignment','no_response','No response from agent'),(p_tenant,'reassignment','admin_fallback','Whole team did not respond');

  INSERT INTO lead_sources (tenant_id, type, name, quality_score) VALUES
   (p_tenant,'manual','Manual entry',50),(p_tenant,'import','Excel / CSV import',40);
  INSERT INTO tenant_currencies (tenant_id, currency) VALUES (p_tenant,'AED');
  INSERT INTO tenant_settings (tenant_id, key, value) VALUES
   (p_tenant,'leads.response_time','{"minutes":10,"next_agent_scope":"team","fallback":"admin"}'),
   (p_tenant,'leads.scoring','{"budget_fit":30,"project_match":20,"source_quality":20,"engagement":30}');
END $$;
