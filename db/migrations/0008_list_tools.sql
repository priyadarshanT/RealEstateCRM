-- 0008: list toolbar of the Lead and Project pages (stakeholder update 2026-10-17): Manage Columns saved per user,
-- Export Leads (selected or all filtered) with the Export Tracker: scope, columns, file name, downloads, expiry.

--- table user_list_columns | Users | The columns each user shows on a list (Manage Columns), in their order.
CREATE TABLE user_list_columns (
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  user_id         uuid NOT NULL,                                   -- User
  list_key        text NOT NULL CHECK (list_key IN ('leads','projects')), -- Which list
  columns         text[] NOT NULL CHECK (cardinality(columns) BETWEEN 1 AND 60), -- Column keys in display order
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last saved
  PRIMARY KEY (tenant_id, user_id, list_key),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE user_list_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_list_columns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_list_columns USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE TRIGGER user_list_columns_updated_at BEFORE UPDATE ON user_list_columns FOR EACH ROW EXECUTE FUNCTION set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON user_list_columns TO crm_app, crm_worker;
GRANT SELECT ON user_list_columns TO crm_readonly;

ALTER TABLE export_logs
  ADD COLUMN scope text CHECK (scope IN ('selected','filtered')),  -- List exports: selected rows or all filtered rows
  ADD COLUMN columns text[] NOT NULL DEFAULT '{}',                 -- List exports: columns in order
  ADD COLUMN file_name text,                                       -- Name of the generated file
  ADD COLUMN download_count integer NOT NULL DEFAULT 0 CHECK (download_count >= 0), -- Times downloaded
  ADD COLUMN expires_at timestamptz;                               -- After this the file can no longer be downloaded
DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'export_logs'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%status = ANY%' AND pg_get_constraintdef(oid) LIKE '%queued%' LOOP
    EXECUTE format('ALTER TABLE export_logs DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE export_logs ADD CONSTRAINT export_logs_status_check CHECK (status IN ('queued','running','completed','failed','expired'));
CREATE INDEX export_logs_report_idx ON export_logs (tenant_id, report_key, created_at DESC);
