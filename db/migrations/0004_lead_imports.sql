-- 0004: Excel / CSV lead imports (SRS §2.4; API: POST /leads/imports → preview → confirm → status).
-- Each import keeps its file, column mapping, preview and counts; rejected rows are saved as a file with the reason.

CREATE TABLE lead_imports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Import ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  file_id         uuid NOT NULL,                                   -- Uploaded Excel / CSV file
  source_id       uuid NOT NULL,                                   -- Lead source for imported leads
  mapping         jsonb NOT NULL DEFAULT '{}',                     -- CRM field → column header
  status          text NOT NULL DEFAULT 'previewing' CHECK (status IN ('previewing','importing','completed','failed')), -- Progress
  preview         jsonb NOT NULL DEFAULT '[]',                     -- First rows with checks, shown before confirming
  rows_total      integer NOT NULL DEFAULT 0 CHECK (rows_total >= 0), -- Data rows in the file
  rows_imported   integer NOT NULL DEFAULT 0 CHECK (rows_imported >= 0), -- New leads created
  rows_re_enquired integer NOT NULL DEFAULT 0 CHECK (rows_re_enquired >= 0), -- Rows added to existing leads (re-enquiry)
  rows_rejected   integer NOT NULL DEFAULT 0 CHECK (rows_rejected >= 0), -- Rows not imported (invalid phone / email, duplicates)
  rejected_rows_file_id uuid,                                      -- CSV of rejected rows with the reason
  error_detail    text,                                            -- Failure detail
  created_by      uuid NOT NULL,                                   -- Who started the import
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Started time
  completed_at    timestamptz,                                     -- Finished time
  UNIQUE (tenant_id, id),
  CHECK ((status IN ('completed','failed')) = (completed_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, file_id) REFERENCES files(tenant_id, id),
  FOREIGN KEY (tenant_id, source_id) REFERENCES lead_sources(tenant_id, id),
  FOREIGN KEY (tenant_id, rejected_rows_file_id) REFERENCES files(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);
CREATE INDEX lead_imports_created_idx ON lead_imports (tenant_id, created_at DESC);

ALTER TABLE lead_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lead_imports USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON lead_imports TO crm_app, crm_worker;
GRANT SELECT ON lead_imports TO crm_readonly;
GRANT SELECT ON idempotency_keys TO crm_readonly;
