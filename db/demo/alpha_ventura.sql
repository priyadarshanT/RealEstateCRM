-- =====================================================================
-- Demo company: Alpha Ventura Real Estate (local / demo databases only, never production)
--
-- One brokerage. Prashant Rajendra is the Director: company-wide scope, so he sees and controls every broker
-- division, team, agent and lead. Each broker firm is a division with its General Manager, a Sales Manager,
-- a Team Leader and three Sales Agents (SRS §4 hierarchy: Director → GM → Sales Manager → Team Leader → Agent).
-- Plus lead sources, leads per agent, developers, projects, units, two deals and attendance settings.
--
-- Run once as the database owner on crm_dev (after setup_db / migrations):
--   psql -d crm_dev -v ON_ERROR_STOP=1 -f db/demo/alpha_ventura.sql
-- Running it again does nothing (it stops if the company already exists).
-- Sign in: company ID cccccccc-0000-0000-0000-000000000001, e.g. prashant@alphaventura.ae
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenants WHERE id = 'cccccccc-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Alpha Ventura Real Estate is already loaded (tenant cccccccc-0000-0000-0000-000000000001)';
  END IF;
END $$;

SELECT set_config('app.tenant_id', 'cccccccc-0000-0000-0000-000000000001', true);

-- ---------------------------------------------------------------- company, defaults, subscription (30 seats)
INSERT INTO tenants (id, type, name, legal_name, trade_license_no, rera_orn, trn, email, phone, address, website, verification_status, verified_at)
VALUES ('cccccccc-0000-0000-0000-000000000001', 'brokerage', 'Alpha Ventura Real Estate', 'Alpha Ventura Real Estate Brokers LLC',
        'TL-AV-884512', 'ORN-31415', '100345678900003', 'info@alphaventura.ae', '+97145501200',
        'Office 2104, Marina Plaza, Dubai Marina, Dubai, UAE', 'https://alphaventura.ae', 'verified', now());

SELECT create_tenant_defaults('cccccccc-0000-0000-0000-000000000001');

INSERT INTO subscriptions (tenant_id, plan_id, status, seats, price_per_seat, card_on_file, current_period_start, current_period_end)
SELECT 'cccccccc-0000-0000-0000-000000000001', id, 'active', 30, 99, true, date_trunc('month', now()), date_trunc('month', now()) + interval '1 month'
FROM plans WHERE key = 'team';

-- ---------------------------------------------------------------- people
-- c1…: leadership, c2…: Marina division, c3…: Downtown division, c4…: Business Bay division
INSERT INTO users (id, tenant_id, email, full_name, phone, role_id, status, languages, location)
SELECT v.id::uuid, 'cccccccc-0000-0000-0000-000000000001', v.email, v.name, v.phone, r.id, 'active', v.langs::text[], v.loc
FROM (VALUES
  -- leadership
  ('c1000000-0000-0000-0000-000000000001', 'prashant@alphaventura.ae', 'Prashant Rajendra',    '+971501110001', 'director',        '{en,hi}', 'Head office'),
  ('c1000000-0000-0000-0000-000000000002', 'admin@alphaventura.ae',    'Sneha Kulkarni',       '+971501110002', 'admin',           '{en,hi}', 'Head office'),
  ('c1000000-0000-0000-0000-000000000003', 'finance@alphaventura.ae',  'Neha Kapoor',          '+971501110003', 'finance',         '{en,hi}', 'Head office'),
  -- Alpha Ventura Marina
  ('c2000000-0000-0000-0000-000000000001', 'arjun.mehta@alphaventura.ae',   'Arjun Mehta',     '+971502220001', 'general_manager', '{en,hi}', 'Dubai Marina'),
  ('c2000000-0000-0000-0000-000000000002', 'rohit.sharma@alphaventura.ae',  'Rohit Sharma',    '+971502220002', 'sales_manager',   '{en,hi}', 'Dubai Marina'),
  ('c2000000-0000-0000-0000-000000000003', 'kavya.nair@alphaventura.ae',    'Kavya Nair',      '+971502220003', 'team_leader',     '{en,ml}', 'Dubai Marina'),
  ('c2000000-0000-0000-0000-000000000004', 'vikram.singh@alphaventura.ae',  'Vikram Singh',    '+971502220004', 'sales_agent',     '{en,hi}', 'Dubai Marina'),
  ('c2000000-0000-0000-0000-000000000005', 'aisha.khan@alphaventura.ae',    'Aisha Khan',      '+971502220005', 'sales_agent',     '{en,ur,ar}', 'Dubai Marina'),
  ('c2000000-0000-0000-0000-000000000006', 'daniel.brooks@alphaventura.ae', 'Daniel Brooks',   '+971502220006', 'sales_agent',     '{en}', 'Dubai Marina'),
  -- Alpha Ventura Downtown
  ('c3000000-0000-0000-0000-000000000001', 'fatima.mansoori@alphaventura.ae', 'Fatima Al Mansoori', '+971503330001', 'general_manager', '{ar,en}', 'Downtown Dubai'),
  ('c3000000-0000-0000-0000-000000000002', 'sameer.joshi@alphaventura.ae',  'Sameer Joshi',    '+971503330002', 'sales_manager',   '{en,hi,mr}', 'Downtown Dubai'),
  ('c3000000-0000-0000-0000-000000000003', 'layla.hassan@alphaventura.ae',  'Layla Hassan',    '+971503330003', 'team_leader',     '{ar,en}', 'Downtown Dubai'),
  ('c3000000-0000-0000-0000-000000000004', 'ivan.petrov@alphaventura.ae',   'Ivan Petrov',     '+971503330004', 'sales_agent',     '{ru,en}', 'Downtown Dubai'),
  ('c3000000-0000-0000-0000-000000000005', 'priya.menon@alphaventura.ae',   'Priya Menon',     '+971503330005', 'sales_agent',     '{en,ml,hi}', 'Downtown Dubai'),
  ('c3000000-0000-0000-0000-000000000006', 'yousef.salem@alphaventura.ae',  'Yousef Salem',    '+971503330006', 'sales_agent',     '{ar,en}', 'Downtown Dubai'),
  -- Alpha Ventura Business Bay
  ('c4000000-0000-0000-0000-000000000001', 'omar.haddad@alphaventura.ae',   'Omar Haddad',     '+971504440001', 'general_manager', '{ar,en,fr}', 'Business Bay'),
  ('c4000000-0000-0000-0000-000000000002', 'anil.deshmukh@alphaventura.ae', 'Anil Deshmukh',   '+971504440002', 'sales_manager',   '{en,hi,mr}', 'Business Bay'),
  ('c4000000-0000-0000-0000-000000000003', 'sara.williams@alphaventura.ae', 'Sara Williams',   '+971504440003', 'team_leader',     '{en}', 'Business Bay'),
  ('c4000000-0000-0000-0000-000000000004', 'chen.wei@alphaventura.ae',      'Chen Wei',        '+971504440004', 'sales_agent',     '{zh,en}', 'Business Bay'),
  ('c4000000-0000-0000-0000-000000000005', 'meera.iyer@alphaventura.ae',    'Meera Iyer',      '+971504440005', 'sales_agent',     '{en,ta,hi}', 'Business Bay'),
  ('c4000000-0000-0000-0000-000000000006', 'hamza.qureshi@alphaventura.ae', 'Hamza Qureshi',   '+971504440006', 'sales_agent',     '{ur,en,ar}', 'Business Bay')
) AS v(id, email, name, phone, role_key, langs, loc)
JOIN roles r ON r.tenant_id = 'cccccccc-0000-0000-0000-000000000001' AND r.key = v.role_key;

-- ---------------------------------------------------------------- broker firms = divisions, one sales team each
INSERT INTO divisions (id, tenant_id, name, gm_user_id) VALUES
  ('c5000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Alpha Ventura Marina',       'c2000000-0000-0000-0000-000000000001'),
  ('c5000000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 'Alpha Ventura Downtown',     'c3000000-0000-0000-0000-000000000001'),
  ('c5000000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001', 'Alpha Ventura Business Bay', 'c4000000-0000-0000-0000-000000000001');

INSERT INTO teams (id, tenant_id, division_id, name, sales_manager_user_id, team_leader_user_id) VALUES
  ('c6000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'Marina Sales',       'c2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000003'),
  ('c6000000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002', 'Downtown Sales',     'c3000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000003'),
  ('c6000000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000003', 'Business Bay Sales', 'c4000000-0000-0000-0000-000000000002', 'c4000000-0000-0000-0000-000000000003');

-- Sales Managers, Team Leaders and agents belong to their division's team.
UPDATE users SET team_id = 'c6000000-0000-0000-0000-000000000001' WHERE id IN ('c2000000-0000-0000-0000-000000000002','c2000000-0000-0000-0000-000000000003','c2000000-0000-0000-0000-000000000004','c2000000-0000-0000-0000-000000000005','c2000000-0000-0000-0000-000000000006');
UPDATE users SET team_id = 'c6000000-0000-0000-0000-000000000002' WHERE id IN ('c3000000-0000-0000-0000-000000000002','c3000000-0000-0000-0000-000000000003','c3000000-0000-0000-0000-000000000004','c3000000-0000-0000-0000-000000000005','c3000000-0000-0000-0000-000000000006');
UPDATE users SET team_id = 'c6000000-0000-0000-0000-000000000003' WHERE id IN ('c4000000-0000-0000-0000-000000000002','c4000000-0000-0000-0000-000000000003','c4000000-0000-0000-0000-000000000004','c4000000-0000-0000-0000-000000000005','c4000000-0000-0000-0000-000000000006');

-- ---------------------------------------------------------------- lead sources
INSERT INTO lead_sources (id, tenant_id, type, name, quality_score) VALUES
  ('c7000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'meta',            'Meta lead ads',   60),
  ('c7000000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 'property_finder', 'Property Finder', 70),
  ('c7000000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001', 'bayut',           'Bayut',           65),
  ('c7000000-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000001', 'website',         'Website',         75),
  ('c7000000-0000-0000-0000-000000000005', 'cccccccc-0000-0000-0000-000000000001', 'referral',        'Referral',        85);

-- ---------------------------------------------------------------- developers, projects, units
INSERT INTO developers (id, tenant_id, name, trn, contact_name, email, phone, website) VALUES
  ('c8000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Emaar Properties', '100067520300003', 'Broker Relations', 'brokers@emaar.example', '+97143673333', 'https://www.emaar.com'),
  ('c8000000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 'Damac Properties', '100064823500003', 'Agency Desk',      'agents@damac.example',  '+97143019999', 'https://www.damacproperties.com'),
  ('c8000000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001', 'Sobha Realty',     '100082236400003', 'Channel Partners', 'partners@sobha.example', '+97144236700', 'https://www.sobharealty.com');

INSERT INTO projects (id, tenant_id, developer_id, name, community, construction_status, handover_date, payment_plan) VALUES
  ('c9000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000001', 'Emaar Beachfront – Seapoint', 'Emaar Beachfront', 'under_construction', '2027-12-31', '90/10'),
  ('c9000000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000001', 'Dubai Creek Harbour – Creek Vista', 'Dubai Creek Harbour', 'off_plan', '2028-06-30', '80/20'),
  ('c9000000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000002', 'Damac Bay 2', 'Dubai Harbour', 'off_plan', '2029-03-31', '60/40'),
  ('c9000000-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000003', 'Sobha Hartland II – Riverside', 'Mohammed Bin Rashid City', 'under_construction', '2027-09-30', '70/30');

INSERT INTO buildings (id, tenant_id, project_id, name, floors, handover_date) VALUES
  ('ca000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', 'Tower 1', 45, '2027-12-31'),
  ('ca000000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002', 'Building A', 40, '2028-06-30'),
  ('ca000000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000003', 'Tower B', 60, '2029-03-31'),
  ('ca000000-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000004', 'Riverside 3', 30, '2027-09-30');

INSERT INTO units (id, tenant_id, project_id, building_id, unit_number, property_type, bedrooms, bathrooms, size_sqft, floor, view, price) VALUES
  ('cb000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', '1204', 'apartment', 2, 3, 1280, 12, 'Sea',     3250000),
  ('cb000000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', '2805', 'apartment', 3, 4, 1750, 28, 'Sea',     4900000),
  ('cb000000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', '4001', 'penthouse', 4, 5, 3900, 40, 'Sea',    12800000),
  ('cb000000-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000002', '907',  'apartment', 1, 2,  780,  9, 'Creek',   1650000),
  ('cb000000-0000-0000-0000-000000000005', 'cccccccc-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000002', '1510', 'apartment', 2, 3, 1150, 15, 'Creek',   2450000),
  ('cb000000-0000-0000-0000-000000000006', 'cccccccc-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000003', '3302', 'apartment', 2, 3, 1320, 33, 'Marina',  3600000),
  ('cb000000-0000-0000-0000-000000000007', 'cccccccc-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000003', '5501', 'apartment', 3, 4, 1980, 55, 'Sea',     5750000),
  ('cb000000-0000-0000-0000-000000000008', 'cccccccc-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000004', 'ca000000-0000-0000-0000-000000000004', '604',  'apartment', 1, 2,  820,  6, 'Lagoon',  1550000),
  ('cb000000-0000-0000-0000-000000000009', 'cccccccc-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000004', NULL,                                   'V-12', 'villa',     4, 5, 4200, NULL, 'Park', 8900000);

-- ---------------------------------------------------------------- leads: two per agent, in their team
INSERT INTO leads (id, tenant_id, full_name, phone_primary, email, country_code, budget_min, budget_max, budget_currency, source_id,
                   stage_id, stage_category, owner_user_id, team_id, assigned_at, next_follow_up_at, priority, latest_note)
SELECT v.id::uuid, 'cccccccc-0000-0000-0000-000000000001', v.name, v.phone, v.email, v.country, v.bmin, v.bmax, 'AED', v.source::uuid,
       s.id, 'open', v.owner::uuid, u.team_id, now() - (v.days || ' days')::interval, now() + (v.follow || ' hours')::interval, v.priority, v.note
FROM (VALUES
  ('cc000000-0000-0000-0000-000000000001', 'Rajesh Gupta',      '+971551000001', 'rajesh.gupta@example.in',  'IN', 3000000::numeric, 4000000::numeric, 'c7000000-0000-0000-0000-000000000001', 'qualified',         'c2000000-0000-0000-0000-000000000004', 6, 20,  'high',   'Wants 2BR sea view, ready to pay 10% EOI'),
  ('cc000000-0000-0000-0000-000000000002', 'Emily Carter',      '+447700900101', 'emily.carter@example.co.uk','GB', 1500000, 2000000, 'c7000000-0000-0000-0000-000000000002', 'follow_up',         'c2000000-0000-0000-0000-000000000004', 3, 48,  'medium', 'Investor, prefers Creek Harbour'),
  ('cc000000-0000-0000-0000-000000000003', 'Ahmed Al Zaabi',    '+971551000003', 'ahmed.zaabi@example.ae',   'AE', 8000000, 13000000, 'c7000000-0000-0000-0000-000000000005', 'meeting_scheduled', 'c2000000-0000-0000-0000-000000000005', 2, 26,  'high',   'Penthouse at Seapoint, meeting with family'),
  ('cc000000-0000-0000-0000-000000000004', 'Fatima Noor',       '+923001000004', 'fatima.noor@example.pk',   'PK', 1200000, 1800000, 'c7000000-0000-0000-0000-000000000003', 'attempted',         'c2000000-0000-0000-0000-000000000005', 1, 4,   'medium', 'Call back after 6 pm'),
  ('cc000000-0000-0000-0000-000000000005', 'Michael Brown',     '+12025550105',  'michael.brown@example.com','US', 4000000, 6000000, 'c7000000-0000-0000-0000-000000000004', 'eoi_submitted',     'c2000000-0000-0000-0000-000000000006', 9, 24,  'high',   'EOI paid for Damac Bay 2'),
  ('cc000000-0000-0000-0000-000000000006', 'Sophie Laurent',    '+33612000106',  'sophie.laurent@example.fr','FR', 2000000, 3000000, 'c7000000-0000-0000-0000-000000000001', 'new',               'c2000000-0000-0000-0000-000000000006', 0, 2,   'medium', NULL),
  ('cc000000-0000-0000-0000-000000000007', 'Dmitri Volkov',     '+79161000107',  'dmitri.volkov@example.ru', 'RU', 5000000, 7000000, 'c7000000-0000-0000-0000-000000000002', 'warm',              'c3000000-0000-0000-0000-000000000004', 5, 30,  'high',   'Cash buyer, 3BR high floor'),
  ('cc000000-0000-0000-0000-000000000008', 'Natalia Sokolova',  '+79161000108',  'natalia.s@example.ru',     'RU', 1500000, 2500000, 'c7000000-0000-0000-0000-000000000001', 'follow_up',         'c3000000-0000-0000-0000-000000000004', 4, 72,  'low',    'Sent brochure on WhatsApp'),
  ('cc000000-0000-0000-0000-000000000009', 'Anand Krishnan',    '+971551000009', 'anand.k@example.ae',       'IN', 2000000, 2500000, 'c7000000-0000-0000-0000-000000000004', 'booked',            'c3000000-0000-0000-0000-000000000005', 12, 96, 'high',   'Unit 1510 booked at Creek Vista'),
  ('cc000000-0000-0000-0000-000000000010', 'Lakshmi Pillai',    '+971551000010', 'lakshmi.p@example.ae',     'IN', 1400000, 1700000, 'c7000000-0000-0000-0000-000000000003', 'pending',           'c3000000-0000-0000-0000-000000000005', 1, 6,   'medium', NULL),
  ('cc000000-0000-0000-0000-000000000011', 'Khalid Al Suwaidi', '+971551000011', 'khalid.s@example.ae',      'AE', 9000000, 12000000, 'c7000000-0000-0000-0000-000000000005', 'viewing_scheduled', 'c3000000-0000-0000-0000-000000000006', 3, 20,  'high',   'Villa viewing at Hartland II'),
  ('cc000000-0000-0000-0000-000000000012', 'Mariam Yousef',     '+971551000012', 'mariam.y@example.ae',      'AE', 3000000, 3800000, 'c7000000-0000-0000-0000-000000000002', 'no_response',       'c3000000-0000-0000-0000-000000000006', 2, 24,  'low',    'Two calls, no answer'),
  ('cc000000-0000-0000-0000-000000000013', 'Li Na',             '+8613800000113','li.na@example.cn',         'CN', 3000000, 5000000, 'c7000000-0000-0000-0000-000000000001', 'hot',               'c4000000-0000-0000-0000-000000000004', 4, 18,  'high',   'Wants payment plan details in Mandarin'),
  ('cc000000-0000-0000-0000-000000000014', 'Wang Jun',          '+8613800000114','wang.jun@example.cn',      'CN', 1500000, 2000000, 'c7000000-0000-0000-0000-000000000003', 'follow_up',         'c4000000-0000-0000-0000-000000000004', 6, 48,  'medium', NULL),
  ('cc000000-0000-0000-0000-000000000015', 'Deepa Raman',       '+971551000015', 'deepa.r@example.ae',       'IN', 1500000, 1600000, 'c7000000-0000-0000-0000-000000000004', 'qualified',         'c4000000-0000-0000-0000-000000000005', 2, 24,  'medium', 'First-time buyer, mortgage pre-approved'),
  ('cc000000-0000-0000-0000-000000000016', 'Thomas Müller',     '+4915100000116','thomas.m@example.de',      'DE', 3500000, 4500000, 'c7000000-0000-0000-0000-000000000002', 'new',               'c4000000-0000-0000-0000-000000000005', 0, 1,   'medium', NULL),
  ('cc000000-0000-0000-0000-000000000017', 'Bilal Ahmed',       '+923001000117', 'bilal.a@example.pk',       'PK', 1800000, 2400000, 'c7000000-0000-0000-0000-000000000001', 'attempted',         'c4000000-0000-0000-0000-000000000006', 1, 5,   'medium', 'Busy, asked for evening call'),
  ('cc000000-0000-0000-0000-000000000018', 'Olivia Smith',      '+61412000118',  'olivia.smith@example.au',  'AU', 2500000, 3500000, 'c7000000-0000-0000-0000-000000000005', 'warm',              'c4000000-0000-0000-0000-000000000006', 7, 36,  'medium', 'Referred by Michael Brown')
) AS v(id, name, phone, email, country, bmin, bmax, source, stage_key, owner, days, follow, priority, note)
JOIN lead_stages s ON s.tenant_id = 'cccccccc-0000-0000-0000-000000000001' AND s.key = v.stage_key
JOIN users u ON u.id = v.owner::uuid;

INSERT INTO lead_projects (tenant_id, lead_id, project_id, is_primary) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', true),
  ('cccccccc-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000002', true),
  ('cccccccc-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000001', true),
  ('cccccccc-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000005', 'c9000000-0000-0000-0000-000000000003', true),
  ('cccccccc-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000007', 'c9000000-0000-0000-0000-000000000003', true),
  ('cccccccc-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000009', 'c9000000-0000-0000-0000-000000000002', true),
  ('cccccccc-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000011', 'c9000000-0000-0000-0000-000000000004', true),
  ('cccccccc-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000013', 'c9000000-0000-0000-0000-000000000003', true),
  ('cccccccc-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000015', 'c9000000-0000-0000-0000-000000000004', true);

INSERT INTO lead_inquiries (tenant_id, lead_id, source_id, submitted_at)
SELECT tenant_id, id, source_id, assigned_at FROM leads WHERE tenant_id = 'cccccccc-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------- deals: an EOI on Damac Bay 2, a booking at Creek Vista
INSERT INTO deals (id, tenant_id, lead_id, project_id, unit_id, owner_user_id, stage, offer_price, offer_date, eoi_amount, eoi_date, booking_amount, booking_date) VALUES
  ('cd000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000005', 'c9000000-0000-0000-0000-000000000003', 'cb000000-0000-0000-0000-000000000007',
   'c2000000-0000-0000-0000-000000000006', 'eoi', 5600000, current_date - 10, 100000, current_date - 8, NULL, NULL),
  ('cd000000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000009', 'c9000000-0000-0000-0000-000000000002', 'cb000000-0000-0000-0000-000000000005',
   'c3000000-0000-0000-0000-000000000005', 'booking', 2400000, current_date - 20, 50000, current_date - 15, 240000, current_date - 6);

UPDATE units SET status = 'on_hold' WHERE id = 'cb000000-0000-0000-0000-000000000007';
UPDATE units SET status = 'booked'  WHERE id = 'cb000000-0000-0000-0000-000000000005';
INSERT INTO unit_changes (tenant_id, unit_id, old_status, new_status, reason, changed_by) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'cb000000-0000-0000-0000-000000000007', 'available', 'on_hold', 'Deal EOI (Michael Brown)', 'c2000000-0000-0000-0000-000000000006'),
  ('cccccccc-0000-0000-0000-000000000001', 'cb000000-0000-0000-0000-000000000005', 'available', 'booked',  'Deal Booking (Anand Krishnan)', 'c3000000-0000-0000-0000-000000000005');

-- ---------------------------------------------------------------- attendance: office hours and leave types
INSERT INTO attendance_policies (tenant_id, name, work_start, work_end, grace_minutes, half_day_max_minutes, weekend_days, is_default) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'Office hours', '09:00', '18:00', 15, 300, '{0,6}', true);
INSERT INTO leave_types (tenant_id, name, annual_days, is_paid) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'Annual', 30, true),
  ('cccccccc-0000-0000-0000-000000000001', 'Sick',   15, true),
  ('cccccccc-0000-0000-0000-000000000001', 'Unpaid', NULL, false);

COMMIT;
