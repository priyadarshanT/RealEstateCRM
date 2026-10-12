-- 0002: storage for the Idempotency-Key header (docs/05-API-Guide.md §5).
-- A retried POST with the same key returns the first result instead of creating a duplicate.

CREATE TABLE idempotency_keys (
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  user_id         uuid NOT NULL,                                   -- Caller
  key             text NOT NULL CHECK (length(key) BETWEEN 1 AND 100), -- Idempotency-Key header value
  method          text NOT NULL,                                   -- HTTP method
  path            text NOT NULL,                                   -- Request path
  request_hash    text NOT NULL,                                   -- SHA-256 of the request body (same key + different body is refused)
  status_code     smallint,                                        -- Stored response status (empty while the first request runs)
  response_body   jsonb,                                           -- Stored response body
  created_at      timestamptz NOT NULL DEFAULT now(),              -- First seen (kept 24 hours)
  PRIMARY KEY (tenant_id, user_id, key),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON idempotency_keys USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO crm_app, crm_worker;
