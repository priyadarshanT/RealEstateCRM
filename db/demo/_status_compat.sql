-- Helpers for the demo scripts (included with \ir), local / demo databases only.
-- The demo data was written with the 15 lead stages that migration 0006 replaced by Hot, Warm, Cold and Sale Done.
-- demo_legacy_stages adds the old stages back for one company (inactive) inside the demo transaction;
-- demo_convert_stages then moves the demo leads exactly as migration 0006 did and removes the old stages again.

CREATE OR REPLACE FUNCTION pg_temp.demo_legacy_stages(t uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.tenant_id', t::text, true);
  INSERT INTO lead_stages (tenant_id, key, name, category, sort_order, is_system, is_active) VALUES
   (t,'new','New','open',101,false,false),(t,'pending','Pending','open',102,false,false),(t,'attempted','Attempted','open',103,false,false),
   (t,'no_response','No Response','open',104,false,false),(t,'follow_up','Follow-up','open',105,false,false),(t,'qualified','Qualified','open',106,false,false),
   (t,'meeting_scheduled','Meeting Scheduled','open',107,false,false),(t,'viewing_scheduled','Viewing Scheduled','open',108,false,false),
   (t,'eoi_submitted','EOI Submitted','open',109,false,false),(t,'booked','Booked','open',110,false,false),(t,'won','Won','won',111,false,false),
   (t,'lost','Lost','lost',112,false,false),(t,'invalid','Invalid','invalid',113,false,false)
  ON CONFLICT (tenant_id, key) DO NOTHING;
  -- Old closed leads carry a reason, not a substatus, until they are converted below.
  ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_closed_substatus_check;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.demo_convert_stages(t uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.tenant_id', t::text, true);
  CREATE TEMP TABLE IF NOT EXISTS demo_stage_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL, new_category text NOT NULL, new_sub uuid);
  TRUNCATE demo_stage_map;
  INSERT INTO demo_stage_map
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
    FROM demo_stage_map m WHERE l.tenant_id = t AND l.stage_id = m.old_id;
  UPDATE lead_stage_history h SET to_stage_id = m.new_id, to_substatus_id = m.new_sub FROM demo_stage_map m WHERE h.tenant_id = t AND h.to_stage_id = m.old_id;
  UPDATE lead_stage_history h SET from_stage_id = m.new_id FROM demo_stage_map m WHERE h.tenant_id = t AND h.from_stage_id = m.old_id;
  DELETE FROM lead_stages WHERE tenant_id = t AND key NOT IN ('hot','warm','cold','sale_done');
  ALTER TABLE leads ADD CONSTRAINT leads_closed_substatus_check CHECK (stage_category NOT IN ('lost','invalid') OR substatus_id IS NOT NULL);
END $$;
