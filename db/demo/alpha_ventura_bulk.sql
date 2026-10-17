-- =====================================================================
-- Demo company Alpha Ventura Real Estate: bulk data for a full dashboard (local / demo databases only)
--
-- Run after alpha_ventura.sql, once, as the database owner:
--   psql -d crm_dev -v ON_ERROR_STOP=1 -f db/demo/alpha_ventura_bulk.sql
-- Adds three more broker divisions with their people, campaigns with daily ad spend, more units, and about
-- 450 leads over the last 90 days (most this month) with stage history, enquiries, calls, follow-ups,
-- meetings today, overdue work, deals (EOI, booking, sold) and lost / invalid leads.
-- Also sets the Director's full name: Prashant Rajendra Mule. Running it again stops without changes.
-- =====================================================================

BEGIN;

-- Written with the old lead stages; converted to Hot / Warm / Cold / Sale Done at the end (_status_compat.sql).
\ir _status_compat.sql
SELECT pg_temp.demo_legacy_stages('cccccccc-0000-0000-0000-000000000001');

DO $$
DECLARE
  t constant uuid := 'cccccccc-0000-0000-0000-000000000001';
  role_gm uuid; role_sm uuid; role_tl uuid; role_agent uuid;
  div_id uuid; team_id_ uuid; gm uuid; sm uuid; tl uuid; u uuid;
  agents uuid[]; sources uuid[]; source_types text[]; projects_ uuid[]; lost_reasons uuid[]; invalid_reasons uuid[];
  camp_by_source jsonb := '{}';
  path text[] := ARRAY['new','attempted','follow_up','qualified','meeting_scheduled','eoi_submitted','booked','won'];
  stage_key text; stage_cat text; idx int; i int; j int; r float8;
  lead_id_ uuid; owner_ uuid; owner_team uuid; created timestamptz; follow timestamptz; closed timestamptz;
  src uuid; src_type text; camp uuid; proj uuid; unit_ uuid; unit_price numeric; deal_stage text;
  first_names text[] := ARRAY['Rahul','Anjali','Mohammed','Sara','John','Elena','Wei','Fatima','Arjun','Olga','Hassan','Maria','David','Aisha','Kiran','Lucas','Noura','Ravi','Emma','Yusuf','Pooja','Ahmed','Sofia','Imran','Hannah','Vikram','Laila','Peter','Zara','Nikhil','Mariam','James','Ananya','Omar','Chloe','Sanjay','Reem','Alex','Divya','Karim'];
  last_names text[] := ARRAY['Sharma','Patel','Al Hashimi','Khan','Smith','Ivanova','Zhang','Al Nuaimi','Reddy','Petrova','Haddad','Garcia','Wilson','Siddiqui','Rao','Silva','Al Ketbi','Verma','Taylor','Ibrahim','Desai','Mahmoud','Rossi','Qureshi','Schmidt','Mehta','Farouk','Novak','Hussain','Joshi','Al Marzouqi','Anderson','Nair','Saleh','Martin','Kulkarni','Al Shamsi','Brown','Pillai','Aziz'];
  countries text[] := ARRAY['IN','AE','GB','RU','CN','PK','SA','DE','FR','US','EG','LB','IT','CA','AU'];
  phone_prefix text[] := ARRAY['+91981','+97150','+44770','+79161','+86138','+92300','+96650','+49151','+33612','+12025','+20100','+96170','+39347','+14165','+61412'];
  n_leads constant int := 450;
BEGIN
  PERFORM set_config('app.tenant_id', t::text, true);
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = t) THEN RAISE EXCEPTION 'Run alpha_ventura.sql first'; END IF;
  IF EXISTS (SELECT 1 FROM divisions WHERE tenant_id = t AND name = 'Alpha Ventura Palm Jumeirah') THEN
    RAISE EXCEPTION 'Bulk demo data is already loaded';
  END IF;

  UPDATE users SET full_name = 'Prashant Rajendra Mule' WHERE id = 'c1000000-0000-0000-0000-000000000001';
  UPDATE subscriptions SET seats = 80 WHERE tenant_id = t;

  SELECT id INTO role_gm FROM roles WHERE tenant_id = t AND key = 'general_manager';
  SELECT id INTO role_sm FROM roles WHERE tenant_id = t AND key = 'sales_manager';
  SELECT id INTO role_tl FROM roles WHERE tenant_id = t AND key = 'team_leader';
  SELECT id INTO role_agent FROM roles WHERE tenant_id = t AND key = 'sales_agent';

  -- ---------------------------------------------------------------- three more broker divisions
  FOR i IN 1..3 LOOP
    INSERT INTO users (tenant_id, email, full_name, phone, role_id, status, languages, location)
    VALUES (t, (ARRAY['nadia.rahman','karthik.raj','hessa.alfalasi'])[i] || '@alphaventura.ae', (ARRAY['Nadia Rahman','Karthik Raj','Hessa Al Falasi'])[i],
            '+97150555' || lpad((i * 10)::text, 4, '0'), role_gm, 'active', '{en,ar}', (ARRAY['Palm Jumeirah','JVC','Dubai Hills'])[i])
    RETURNING id INTO gm;
    INSERT INTO divisions (tenant_id, name, gm_user_id) VALUES (t, 'Alpha Ventura ' || (ARRAY['Palm Jumeirah','JVC','Dubai Hills'])[i], gm) RETURNING id INTO div_id;
    INSERT INTO users (tenant_id, email, full_name, phone, role_id, status, languages, location)
    VALUES (t, (ARRAY['george.mathew','tariq.aziz','ritu.agarwal'])[i] || '@alphaventura.ae', (ARRAY['George Mathew','Tariq Aziz','Ritu Agarwal'])[i],
            '+97150555' || lpad((i * 10 + 1)::text, 4, '0'), role_sm, 'active', '{en,hi}', (ARRAY['Palm Jumeirah','JVC','Dubai Hills'])[i])
    RETURNING id INTO sm;
    INSERT INTO users (tenant_id, email, full_name, phone, role_id, status, languages, location)
    VALUES (t, (ARRAY['nina.kovac','faisal.karim','ishita.bose'])[i] || '@alphaventura.ae', (ARRAY['Nina Kovac','Faisal Karim','Ishita Bose'])[i],
            '+97150555' || lpad((i * 10 + 2)::text, 4, '0'), role_tl, 'active', '{en}', (ARRAY['Palm Jumeirah','JVC','Dubai Hills'])[i])
    RETURNING id INTO tl;
    INSERT INTO teams (tenant_id, division_id, name, sales_manager_user_id, team_leader_user_id)
    VALUES (t, div_id, (ARRAY['Palm Jumeirah Sales','JVC Sales','Dubai Hills Sales'])[i], sm, tl) RETURNING id INTO team_id_;
    UPDATE users SET team_id = team_id_ WHERE id IN (sm, tl);
    FOR j IN 1..5 LOOP
      INSERT INTO users (tenant_id, email, full_name, phone, role_id, team_id, status, languages, location)
      VALUES (t, lower(replace(first_names[(i * 7 + j) % 40 + 1] || '.' || last_names[(i * 11 + j * 3) % 40 + 1], ' ', '')) || i || j || '@alphaventura.ae',
              first_names[(i * 7 + j) % 40 + 1] || ' ' || last_names[(i * 11 + j * 3) % 40 + 1],
              '+97150555' || lpad((i * 10 + 2 + j)::text, 4, '0') || '0', role_agent, team_id_, 'active', '{en}', (ARRAY['Palm Jumeirah','JVC','Dubai Hills'])[i]);
    END LOOP;
  END LOOP;

  -- ---------------------------------------------------------------- campaigns and daily ad spend (45 days)
  FOR i IN 1..6 LOOP
    INSERT INTO campaigns (tenant_id, source_id, name, status, starts_on)
    VALUES (t, (ARRAY['c7000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000001',
                      'c7000000-0000-0000-0000-000000000002','c7000000-0000-0000-0000-000000000003','c7000000-0000-0000-0000-000000000004'])[i]::uuid,
            (ARRAY['Seapoint Launch – Meta','Creek Vista Investors – Meta','Damac Bay 2 Pre-launch – Meta','Property Finder Premium Listings','Bayut Featured Agents','Website SEO & Landing Pages'])[i],
            'active', current_date - 60)
    RETURNING id INTO camp;
    camp_by_source := jsonb_set(camp_by_source, ARRAY[(ARRAY['c7000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000001',
                      'c7000000-0000-0000-0000-000000000002','c7000000-0000-0000-0000-000000000003','c7000000-0000-0000-0000-000000000004'])[i]],
                      coalesce(camp_by_source -> (ARRAY['c7000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000001',
                      'c7000000-0000-0000-0000-000000000002','c7000000-0000-0000-0000-000000000003','c7000000-0000-0000-0000-000000000004'])[i], '[]'::jsonb) || to_jsonb(camp::text));
    INSERT INTO ad_spend_daily (tenant_id, campaign_id, spend_date, amount, currency, entry_method)
    SELECT t, camp, d::date, round((400 + random() * 1400)::numeric, 2), 'AED', 'manual'
    FROM generate_series(current_date - 44, current_date, interval '1 day') d;
  END LOOP;

  -- ---------------------------------------------------------------- more units (25 per project)
  INSERT INTO units (tenant_id, project_id, unit_number, property_type, bedrooms, bathrooms, size_sqft, floor, view, price)
  SELECT t, p.id, 'U-' || (100 * f + n), CASE WHEN n % 9 = 0 THEN 'penthouse' ELSE 'apartment' END, 1 + (n % 4), 2 + (n % 4),
         650 + (n % 4) * 420 + f * 5, f, (ARRAY['Sea','Marina','Creek','Park','City'])[1 + n % 5], 1100000 + (n % 4) * 900000 + f * 25000
  FROM projects p, generate_series(1, 5) f, generate_series(1, 5) n
  WHERE p.tenant_id = t;

  -- ---------------------------------------------------------------- lookups
  SELECT array_agg(u2.id ORDER BY u2.email) INTO agents FROM users u2 JOIN roles r2 ON r2.id = u2.role_id WHERE u2.tenant_id = t AND r2.key = 'sales_agent';
  SELECT array_agg(id ORDER BY name), array_agg(type ORDER BY name) INTO sources, source_types FROM lead_sources WHERE tenant_id = t AND type IN ('meta','property_finder','bayut','website','referral');
  SELECT array_agg(id) INTO projects_ FROM projects WHERE tenant_id = t;
  SELECT array_agg(id) INTO lost_reasons FROM reasons WHERE tenant_id = t AND type = 'lost';
  SELECT array_agg(id) INTO invalid_reasons FROM reasons WHERE tenant_id = t AND type = 'invalid';

  -- ---------------------------------------------------------------- leads with history, tasks and deals
  FOR i IN 1..n_leads LOOP
    r := random();
    stage_key := CASE
      WHEN r < 0.12 THEN 'new' WHEN r < 0.18 THEN 'pending' WHEN r < 0.26 THEN 'attempted' WHEN r < 0.32 THEN 'no_response'
      WHEN r < 0.44 THEN 'follow_up' WHEN r < 0.52 THEN 'warm' WHEN r < 0.58 THEN 'hot' WHEN r < 0.66 THEN 'qualified'
      WHEN r < 0.72 THEN 'meeting_scheduled' WHEN r < 0.77 THEN 'viewing_scheduled' WHEN r < 0.81 THEN 'eoi_submitted'
      WHEN r < 0.84 THEN 'booked' WHEN r < 0.90 THEN 'won' WHEN r < 0.98 THEN 'lost' ELSE 'invalid' END;
    stage_cat := CASE stage_key WHEN 'won' THEN 'won' WHEN 'lost' THEN 'lost' WHEN 'invalid' THEN 'invalid' ELSE 'open' END;
    -- 60% of leads arrived this month, the rest over the previous 75 days.
    created := CASE WHEN random() < 0.6
      THEN date_trunc('month', now()) + random() * (now() - date_trunc('month', now()))
      ELSE date_trunc('month', now()) - (random() * 75 || ' days')::interval END;
    owner_ := CASE WHEN stage_key IN ('new','pending') AND random() < 0.25 THEN NULL ELSE agents[1 + floor(random() * array_length(agents, 1))::int] END;
    SELECT team_id INTO owner_team FROM users WHERE id = owner_;
    j := 1 + floor(random() * array_length(sources, 1))::int;
    src := sources[j]; src_type := source_types[j];
    camp := CASE WHEN camp_by_source ? src::text THEN ((camp_by_source -> src::text) ->> floor(random() * jsonb_array_length(camp_by_source -> src::text))::int)::uuid END;
    proj := projects_[1 + floor(random() * array_length(projects_, 1))::int];
    closed := CASE WHEN stage_cat <> 'open' THEN least(now(), created + (1 + random() * 20 || ' days')::interval) END;
    -- Open work: a quarter is overdue, the rest due in the coming days.
    follow := CASE WHEN stage_cat = 'open' AND owner_ IS NOT NULL
      THEN CASE WHEN random() < 0.25 THEN now() - (1 + random() * 72 || ' hours')::interval ELSE now() + (1 + random() * 120 || ' hours')::interval END END;

    INSERT INTO leads (tenant_id, full_name, phone_primary, email, country_code, budget_min, budget_max, budget_currency, source_id, campaign_id,
                       stage_id, stage_category, owner_user_id, team_id, assigned_at, next_follow_up_at, first_response_at, closed_at, close_reason_id,
                       priority, score, enquiry_count, created_at, last_enquiry_at, last_activity_at)
    SELECT t,
           first_names[1 + (i * 7) % 40] || ' ' || last_names[1 + (i * 13) % 40],
           phone_prefix[1 + i % 15] || lpad((1000000 + i * 37)::text, 7, '0'),
           lower(replace(first_names[1 + (i * 7) % 40] || '.' || last_names[1 + (i * 13) % 40], ' ', '')) || i || '@example.com',
           countries[1 + i % 15],
           (1000000 + (i % 8) * 500000)::numeric, (1500000 + (i % 8) * 700000)::numeric, 'AED', src, camp,
           s.id, stage_cat, owner_, owner_team, CASE WHEN owner_ IS NOT NULL THEN created + interval '2 minutes' END, follow,
           CASE WHEN owner_ IS NOT NULL AND stage_key NOT IN ('new','pending') THEN created + (5 + random() * 120 || ' minutes')::interval END,
           closed,
           CASE stage_key WHEN 'lost' THEN lost_reasons[1 + floor(random() * array_length(lost_reasons, 1))::int]
                          WHEN 'invalid' THEN invalid_reasons[1 + floor(random() * array_length(invalid_reasons, 1))::int] END,
           (ARRAY['low','medium','medium','high'])[1 + i % 4], 10 + floor(random() * 85)::int,
           CASE WHEN random() < 0.08 THEN 2 ELSE 1 END, created, created, coalesce(closed, created + interval '1 day')
    FROM lead_stages s WHERE s.tenant_id = t AND s.key = stage_key
    RETURNING id INTO lead_id_;

    INSERT INTO lead_inquiries (tenant_id, lead_id, source_id, campaign_id, submitted_at) VALUES (t, lead_id_, src, camp, created);
    INSERT INTO lead_projects (tenant_id, lead_id, project_id, is_primary) VALUES (t, lead_id_, proj, true);

    -- Stage history along the sales path up to the current stage (Lost / Invalid after a first attempt).
    IF stage_key IN ('lost','invalid') THEN
      INSERT INTO lead_stage_history (tenant_id, lead_id, from_stage_id, to_stage_id, is_automatic, changed_at)
      SELECT t, lead_id_, NULL, id, true, created FROM lead_stages WHERE tenant_id = t AND key = 'new';
      INSERT INTO lead_stage_history (tenant_id, lead_id, from_stage_id, to_stage_id, reason_id, changed_by, changed_at)
      SELECT t, lead_id_, (SELECT id FROM lead_stages WHERE tenant_id = t AND key = 'new'), s.id,
             (SELECT close_reason_id FROM leads WHERE id = lead_id_), owner_, closed
      FROM lead_stages s WHERE s.tenant_id = t AND s.key = stage_key;
    ELSE
      idx := coalesce(array_position(path, stage_key), CASE stage_key WHEN 'pending' THEN 1 WHEN 'no_response' THEN 2 WHEN 'warm' THEN 3 WHEN 'hot' THEN 3 WHEN 'viewing_scheduled' THEN 5 ELSE 1 END);
      FOR j IN 1..idx LOOP
        INSERT INTO lead_stage_history (tenant_id, lead_id, from_stage_id, to_stage_id, is_automatic, changed_by, changed_at)
        SELECT t, lead_id_, (SELECT id FROM lead_stages WHERE tenant_id = t AND key = path[j - 1]), s.id, j = 1, CASE WHEN j > 1 THEN owner_ END,
               least(now(), created + ((j - 1) * (1 + random() * 3) || ' days')::interval)
        FROM lead_stages s WHERE s.tenant_id = t AND s.key = path[j];
      END LOOP;
      IF stage_key NOT IN (SELECT unnest(path)) THEN
        INSERT INTO lead_stage_history (tenant_id, lead_id, from_stage_id, to_stage_id, changed_by, changed_at)
        SELECT t, lead_id_, (SELECT id FROM lead_stages WHERE tenant_id = t AND key = path[idx]), s.id, owner_, least(now(), created + interval '2 days')
        FROM lead_stages s WHERE s.tenant_id = t AND s.key = stage_key;
      END IF;
    END IF;

    IF owner_ IS NOT NULL THEN
      -- Calls already made (with outcomes) for worked leads.
      IF stage_key NOT IN ('new','pending') THEN
        INSERT INTO tasks (tenant_id, lead_id, assigned_user_id, type, title, due_at, status, outcome, completed_at, completed_by, created_at)
        SELECT t, lead_id_, owner_, 'call', 'Call ' || (SELECT full_name FROM leads WHERE id = lead_id_), created + interval '15 minutes', 'completed',
               (ARRAY['answered','answered','answered','no_answer','busy','call_back','wrong_number'])[1 + floor(random() * 7)::int],
               created + interval '20 minutes', owner_, created
        FROM generate_series(1, 1 + floor(random() * 3)::int);
      END IF;
      -- The next planned action (open; some overdue).
      IF stage_cat = 'open' THEN
        INSERT INTO tasks (tenant_id, lead_id, assigned_user_id, type, title, due_at, duration_minutes, status, created_at)
        VALUES (t, lead_id_, owner_,
                CASE WHEN stage_key = 'meeting_scheduled' THEN 'meeting' WHEN stage_key = 'viewing_scheduled' THEN 'viewing' WHEN random() < 0.5 THEN 'call' ELSE 'follow_up' END,
                CASE WHEN stage_key = 'meeting_scheduled' THEN 'Meeting' WHEN stage_key = 'viewing_scheduled' THEN 'Viewing' ELSE 'Follow-up' END || ' – ' || (SELECT full_name FROM leads WHERE id = lead_id_),
                -- Meetings and viewings: about a third today, so "Meetings today" is filled.
                CASE WHEN stage_key IN ('meeting_scheduled','viewing_scheduled') AND random() < 0.35
                     THEN date_trunc('day', now()) + ((10 + floor(random() * 8)) || ' hours')::interval ELSE follow END,
                CASE WHEN stage_key IN ('meeting_scheduled','viewing_scheduled') THEN 60 END, 'open', created);
      END IF;
    END IF;

    -- Deals: EOI holds a unit, booking books it, won = sold.
    IF stage_key IN ('eoi_submitted','booked','won') AND owner_ IS NOT NULL THEN
      SELECT id, price INTO unit_, unit_price FROM units WHERE tenant_id = t AND project_id = proj AND status = 'available' ORDER BY random() LIMIT 1;
      IF unit_ IS NOT NULL THEN
        deal_stage := CASE stage_key WHEN 'eoi_submitted' THEN 'eoi' WHEN 'booked' THEN 'booking' ELSE 'sold' END;
        INSERT INTO deals (tenant_id, lead_id, project_id, unit_id, owner_user_id, stage, offer_price, offer_date, eoi_amount, eoi_date,
                           booking_amount, booking_date, sale_value, sale_date, created_at)
        VALUES (t, lead_id_, proj, unit_, owner_, deal_stage, unit_price * 0.97, created::date, round(unit_price * 0.02), (created + interval '2 days')::date,
                CASE WHEN deal_stage <> 'eoi' THEN round(unit_price * 0.1) END,
                CASE WHEN deal_stage <> 'eoi' THEN least(current_date, (created + interval '5 days')::date) END,
                CASE WHEN deal_stage = 'sold' THEN round(unit_price * 0.98) END,
                CASE WHEN deal_stage = 'sold' THEN coalesce(closed, now())::date END, created);
        UPDATE units SET status = CASE deal_stage WHEN 'eoi' THEN 'on_hold' WHEN 'booking' THEN 'booked' ELSE 'sold' END WHERE id = unit_;
      END IF;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- ---------------------------------------------------------------- commission invoices to developers (some part paid, one overdue)
-- Created as drafts with their lines (lines can only change on drafts), then approved, sent and paid.
BEGIN;
SELECT set_config('app.tenant_id', 'cccccccc-0000-0000-0000-000000000001', true);
INSERT INTO counterparties (tenant_id, type, name, trn, email, developer_id)
SELECT tenant_id, 'developer', name, trn, email, id FROM developers WHERE tenant_id = 'cccccccc-0000-0000-0000-000000000001';
CREATE TEMP TABLE demo_invoices ON COMMIT DROP AS
SELECT gen_random_uuid() AS id, g, c.id AS counterparty_id, (60000 + g * 15000)::numeric AS subtotal
FROM generate_series(1, 9) g
JOIN LATERAL (SELECT id FROM counterparties WHERE tenant_id = 'cccccccc-0000-0000-0000-000000000001' AND type = 'developer' ORDER BY name OFFSET (g % 3) LIMIT 1) c ON true;
INSERT INTO finance_documents (id, tenant_id, doc_type, counterparty_id, issue_date, due_date, currency, subtotal, tax_total, payment_terms, created_by)
SELECT id, 'cccccccc-0000-0000-0000-000000000001', 'sales_invoice', counterparty_id, current_date - (g * 6), current_date - (g * 6) + 30, 'AED',
       subtotal, subtotal * 0.05, '30 days', 'c1000000-0000-0000-0000-000000000003'
FROM demo_invoices;
INSERT INTO finance_document_lines (tenant_id, document_id, line_no, description, quantity, unit_price, tax_rate, line_subtotal, tax_amount)
SELECT 'cccccccc-0000-0000-0000-000000000001', id, 1, 'Agency commission 2%', 1, subtotal, 5, subtotal, subtotal * 0.05 FROM demo_invoices;
UPDATE finance_documents d
SET number = 'INV-' || extract(year FROM now())::int || '-' || lpad(i.g::text, 4, '0'),
    status = CASE WHEN i.g % 3 = 0 THEN 'paid' WHEN d.due_date < current_date THEN 'overdue' WHEN i.g % 3 = 1 THEN 'partially_paid' ELSE 'sent' END,
    amount_paid = CASE WHEN i.g % 3 = 0 THEN i.subtotal * 1.05 WHEN i.g % 3 = 1 THEN 25000 ELSE 0 END,
    approved_by = 'c1000000-0000-0000-0000-000000000001', approved_at = now() - (i.g * 6 || ' days')::interval, sent_at = now() - (i.g * 6 || ' days')::interval
FROM demo_invoices i WHERE d.id = i.id;
INSERT INTO document_sequences (tenant_id, doc_type, prefix, include_year, padding, current_year, next_number)
VALUES ('cccccccc-0000-0000-0000-000000000001', 'sales_invoice', 'INV-', true, 4, extract(year FROM now())::int, 10)
ON CONFLICT (tenant_id, doc_type) DO NOTHING;
SELECT pg_temp.demo_convert_stages('cccccccc-0000-0000-0000-000000000001');
COMMIT;
