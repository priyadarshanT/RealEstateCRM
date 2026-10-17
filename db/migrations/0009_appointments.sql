-- 0009: appointments from the Lead page (stakeholder update 2026-10-17, Lead page §3, §8): call, Zoom / online
-- meeting, event and property viewing; an online meeting can carry a link the agent pastes (e.g. Zoom) without a
-- Zoom integration; notes; and each lead's next appointment for the Appointment Date filter and calendar.

DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'meetings'::regclass AND contype = 'c'
            AND (pg_get_constraintdef(oid) LIKE '%''meeting''::text, ''viewing''::text%' OR pg_get_constraintdef(oid) LIKE '%''google_meet''::text, ''teams''::text, ''in_person''::text, ''phone''::text]%') LOOP
    EXECUTE format('ALTER TABLE meetings DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE meetings
  ADD CONSTRAINT meetings_type_check CHECK (type IN ('meeting','viewing','call','event')),
  ADD CONSTRAINT meetings_channel_check CHECK (channel IN ('google_meet','teams','in_person','phone','online_link')),
  ADD COLUMN notes text;                                           -- Agent's notes for the appointment

ALTER TABLE leads ADD COLUMN next_appointment_at timestamptz;     -- Start of the earliest scheduled appointment (Appointment Date filter)
CREATE INDEX leads_next_appointment_idx ON leads (tenant_id, next_appointment_at) WHERE next_appointment_at IS NOT NULL;
DO $$ DECLARE t uuid; BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    UPDATE leads l SET next_appointment_at = m.first
      FROM (SELECT lead_id, min(starts_at) AS first FROM meetings WHERE tenant_id = t AND status = 'scheduled' GROUP BY lead_id) m
     WHERE l.tenant_id = t AND m.lead_id = l.id;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
