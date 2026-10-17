-- =====================================================================
-- Dubai Real Estate CRM · PostgreSQL 16 schema · v1.2 · 11 Oct 2026 (matches SRS v1.2)
-- Conventions
--  * Every business table has tenant_id and UNIQUE (tenant_id, id).
--  * Child tables reference parents with (tenant_id, <fk>) so a row can
--    never point to another tenant's data (enforced by the database).
--  * Row-level security limits every query to app.tenant_id.
--  * Value lists use text + CHECK (easy to extend in a migration).
--  * Money: numeric(14,2) + ISO currency code. Times: timestamptz (UTC).
--  * Primary keys: uuid (application generates UUIDv7; DB default v4).
-- Lines ending in "-- text" become column descriptions (data dictionary).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ============================ GLOBAL ================================

--- table currencies | Global | ISO 4217 currencies the system can use.
CREATE TABLE currencies (
  code            char(3) PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'), -- ISO currency code, e.g. AED
  name            text NOT NULL,                                   -- Currency name
  decimals        smallint NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 3) -- Decimal places
);

--- table permissions | Global | Catalogue of actions that can be granted to roles.
CREATE TABLE permissions (
  key             text PRIMARY KEY CHECK (key ~ '^[a-z_]+\.[a-z_]+$'), -- Permission key, e.g. leads.export
  module          text NOT NULL,                                   -- Module the action belongs to
  description     text NOT NULL                                    -- What the permission allows
);

--- table platform_admins | Platform | People who run the CRM business (owner console). Not part of any tenant.
CREATE TABLE platform_admins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Platform admin ID
  auth_subject    text UNIQUE,                                     -- Login provider user ID (separate Cognito pool, two-factor required)
  email           citext NOT NULL UNIQUE,                          -- Login email
  full_name       text NOT NULL,                                   -- Full name
  role            text NOT NULL CHECK (role IN ('owner','support','billing')), -- owner = everything; support = view tenants; billing = payments
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')), -- Account status
  last_login_at   timestamptz,                                     -- Last successful login
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now()               -- Last update time
);

--- table plans | Platform | Subscription plans we sell (Solo, Team, Enterprise) and their prices.
CREATE TABLE plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Plan ID
  key             text NOT NULL UNIQUE CHECK (key ~ '^[a-z_]+$'),  -- Stable key, e.g. team
  name            text NOT NULL,                                   -- Display name
  description     text,                                            -- Shown on the pricing page
  tenant_type     text CHECK (tenant_type IN ('brokerage','individual')), -- Who may choose it (empty = both)
  price_monthly   numeric(14,2) NOT NULL CHECK (price_monthly >= 0), -- Price per user per month, excluding VAT
  price_yearly    numeric(14,2) NOT NULL CHECK (price_yearly >= 0), -- Price per user per year, excluding VAT
  currency        char(3) NOT NULL DEFAULT 'AED' REFERENCES currencies(code), -- Price currency
  min_seats       integer NOT NULL DEFAULT 1 CHECK (min_seats >= 1), -- Minimum users
  max_seats       integer CHECK (max_seats IS NULL OR max_seats >= min_seats), -- Maximum users (empty = no limit)
  self_service    boolean NOT NULL DEFAULT true,                   -- Can be bought online (false = through sales, e.g. Enterprise)
  is_active       boolean NOT NULL DEFAULT true,                   -- Offered to new customers
  sort_order      smallint NOT NULL DEFAULT 0,                     -- Order on the pricing page
  stripe_price_monthly_id text,                                    -- Stripe price ID (monthly)
  stripe_price_yearly_id text,                                     -- Stripe price ID (yearly)
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now()               -- Last update time
);

--- table platform_settings | Platform | Business-wide settings: trial days, grace days, data retention, VAT rate.
CREATE TABLE platform_settings (
  key             text PRIMARY KEY CHECK (key ~ '^[a-z_]+\.[a-z_]+$'), -- Setting key, e.g. billing.grace_days
  value           jsonb NOT NULL,                                  -- Setting value
  updated_by      uuid REFERENCES platform_admins(id),             -- Last changed by
  updated_at      timestamptz NOT NULL DEFAULT now()               -- Last update time
);

--- table sales_enquiries | Platform | Enterprise and "talk to sales" requests from the website.
CREATE TABLE sales_enquiries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Enquiry ID
  company_name    text NOT NULL,                                   -- Company name
  contact_name    text NOT NULL,                                   -- Contact person
  email           citext NOT NULL,                                 -- Contact email
  phone           text,                                            -- Contact phone (E.164)
  users_estimate  integer CHECK (users_estimate IS NULL OR users_estimate > 0), -- Expected number of users
  message         text,                                            -- Message
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','won','lost')), -- Sales status
  handled_by      uuid REFERENCES platform_admins(id),             -- Platform admin handling it
  tenant_id       uuid,                                            -- Tenant created when won
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Received time
  updated_at      timestamptz NOT NULL DEFAULT now()               -- Last update time
);

-- ========================= ORGANIZATION =============================

--- table tenants | Organization | One customer account: a brokerage (B2B) or an individual agent (B2C).
CREATE TABLE tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Tenant ID
  type            text NOT NULL CHECK (type IN ('brokerage','individual')), -- B2B brokerage or B2C individual agent
  name            text NOT NULL,                                   -- Display name
  legal_name      text,                                            -- Registered company name
  trade_license_no text,                                           -- Dubai trade licence number
  rera_orn        text,                                            -- RERA office registration number (ORN), required for brokerages
  rera_brn        text,                                            -- RERA broker card number (BRN), required for individual agents
  trn             text,                                            -- UAE VAT tax registration number
  email           citext,                                          -- Company email
  phone           text,                                            -- Company phone (E.164)
  address         text,                                            -- Company address
  website         text,                                            -- Company website
  logo_file_id    uuid,                                            -- Logo image (files)
  country_code    char(2) NOT NULL DEFAULT 'AE' CHECK (country_code ~ '^[A-Z]{2}$'), -- ISO country code
  timezone        text NOT NULL DEFAULT 'Asia/Dubai',              -- Default IANA time zone
  base_currency   char(3) NOT NULL DEFAULT 'AED' REFERENCES currencies(code), -- Reporting currency
  trade_license_file_id uuid,                                      -- Uploaded trade licence or broker card (files)
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected')), -- RERA / licence check by the platform team
  verified_by     uuid REFERENCES platform_admins(id),             -- Platform admin who verified
  verified_at     timestamptz,                                     -- Verification time
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')), -- Platform switch (suspended by owner; closed after cancellation); billing state is in subscriptions
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  CHECK (type <> 'brokerage' OR (trade_license_no IS NOT NULL AND rera_orn IS NOT NULL)),
  CHECK (type <> 'individual' OR rera_brn IS NOT NULL),
  CHECK ((verification_status = 'verified') = (verified_at IS NOT NULL))
);

--- table roles | Organization | Roles per tenant (Director, GM, Sales Manager, Team Leader, Agent, Admin, Finance) and their data scope.
CREATE TABLE roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Role ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  key             text NOT NULL CHECK (key ~ '^[a-z_]+$'),         -- Stable key, e.g. sales_agent
  name            text NOT NULL,                                   -- Display name
  data_scope      text NOT NULL CHECK (data_scope IN ('own','team','division','company')), -- Which records the role can see
  is_system       boolean NOT NULL DEFAULT false,                  -- Built-in role (cannot be deleted)
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, key)
);

--- table role_permissions | Organization | Which actions each role may perform.
CREATE TABLE role_permissions (
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  role_id         uuid NOT NULL,                                   -- Role
  permission_key  text NOT NULL REFERENCES permissions(key),       -- Granted permission
  PRIMARY KEY (role_id, permission_key),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id) ON DELETE CASCADE
);

--- table users | Organization | People who log in. Each user belongs to one tenant and has one role.
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- User ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  auth_subject    text UNIQUE,                                     -- Login provider user ID (Cognito sub); empty until invite accepted
  email           citext NOT NULL,                                 -- Login email
  full_name       text NOT NULL,                                   -- Full name
  phone           text CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),     -- Mobile (E.164)
  role_id         uuid NOT NULL,                                   -- Role
  team_id         uuid,                                            -- Team (agents and team leaders)
  status          text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','inactive')), -- Account status
  receives_leads  boolean NOT NULL DEFAULT true,                   -- Admin switch: user gets new leads (existing leads unaffected)
  languages       text[] NOT NULL DEFAULT '{}',                    -- Spoken languages (ISO 639-1) for assignment rules
  location        text,                                            -- Office or area, for assignment rules
  timezone        text NOT NULL DEFAULT 'Asia/Dubai',              -- Display time zone
  attendance_policy_id uuid,                                       -- Attendance policy override (default policy if empty)
  last_login_at   timestamptz,                                     -- Last successful login
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, email),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id)
);

--- table divisions | Organization | Business divisions, each run by one General Manager.
CREATE TABLE divisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Division ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  name            text NOT NULL,                                   -- Division name
  gm_user_id      uuid,                                            -- General Manager
  is_active       boolean NOT NULL DEFAULT true,                   -- Active flag
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name),
  FOREIGN KEY (tenant_id, gm_user_id) REFERENCES users(tenant_id, id)
);

--- table teams | Organization | Sales teams. A Sales Manager can manage several teams; each team has one Team Leader.
CREATE TABLE teams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Team ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  division_id     uuid,                                            -- Division the team belongs to
  name            text NOT NULL,                                   -- Team name
  sales_manager_user_id uuid,                                      -- Sales Manager responsible for the team
  team_leader_user_id   uuid,                                      -- Team Leader
  is_active       boolean NOT NULL DEFAULT true,                   -- Active flag
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name),
  FOREIGN KEY (tenant_id, division_id) REFERENCES divisions(tenant_id, id),
  FOREIGN KEY (tenant_id, sales_manager_user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, team_leader_user_id) REFERENCES users(tenant_id, id)
);
ALTER TABLE users ADD FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id);

--- table tenant_settings | Settings | Tenant configuration values (response time, auto-close policy, scoring weights, work hours, etc.).
CREATE TABLE tenant_settings (
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  key             text NOT NULL CHECK (key ~ '^[a-z_.]+$'),        -- Setting key, e.g. leads.auto_close
  value           jsonb NOT NULL,                                  -- Setting value (validated by the application)
  updated_by      uuid,                                            -- Last changed by
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  PRIMARY KEY (tenant_id, key),
  FOREIGN KEY (tenant_id, updated_by) REFERENCES users(tenant_id, id)
);

--- table tenant_currencies | Settings | Currencies enabled for a tenant.
CREATE TABLE tenant_currencies (
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  currency        char(3) NOT NULL REFERENCES currencies(code),    -- Enabled currency
  PRIMARY KEY (tenant_id, currency)
);

--- table exchange_rates | Settings | Exchange rates to the tenant base currency, used for report totals.
CREATE TABLE exchange_rates (
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  currency        char(3) NOT NULL REFERENCES currencies(code),    -- Currency
  effective_date  date NOT NULL,                                   -- Rate valid from this date
  rate_to_base    numeric(18,8) NOT NULL CHECK (rate_to_base > 0), -- 1 unit of currency = rate_to_base units of base currency
  PRIMARY KEY (tenant_id, currency, effective_date)
);

--- table files | Shared | Every uploaded or generated file. The file itself is stored in S3.
CREATE TABLE files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- File ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  storage_key     text NOT NULL UNIQUE,                            -- S3 object key
  file_name       text NOT NULL,                                   -- Original file name
  mime_type       text NOT NULL,                                   -- Content type
  size_bytes      bigint NOT NULL CHECK (size_bytes >= 0),         -- Size in bytes
  checksum_sha256 text,                                            -- Integrity checksum
  uploaded_by     uuid,                                            -- Uploaded by (empty = system)
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Upload time
  deleted_at      timestamptz,                                     -- Soft delete time
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, uploaded_by) REFERENCES users(tenant_id, id)
);
ALTER TABLE tenants ADD FOREIGN KEY (id, logo_file_id) REFERENCES files(tenant_id, id);

-- ========================== INTEGRATIONS ============================

--- table integrations | Integrations | Connected outside accounts (Meta, WhatsApp, portals, Google, Microsoft, general webhook). Tokens live in AWS SSM, not here.
CREATE TABLE integrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Integration ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  provider        text NOT NULL CHECK (provider IN ('meta','google_ads','linkedin','snapchat','tiktok','website','webhook','property_finder','bayut','dubizzle','whatsapp_cloud','email_ses','gmail','microsoft_365','google_workspace')), -- Provider (website/webhook = general webhook; google_workspace = Calendar + Meet; microsoft_365 = Calendar + Teams + mail)
  scope           text NOT NULL DEFAULT 'tenant' CHECK (scope IN ('tenant','user')), -- Company-wide or one user's account
  user_id         uuid,                                            -- Owner user when scope = user
  account_label   text NOT NULL,                                   -- Display label, e.g. page or number
  external_account_id text,                                        -- Account ID at the provider
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','error','disconnected')), -- Connection status
  secret_ref      text,                                            -- AWS SSM parameter path holding the tokens
  settings        jsonb NOT NULL DEFAULT '{}',                     -- Provider-specific settings
  last_success_at timestamptz,                                     -- Last successful sync
  last_error_at   timestamptz,                                     -- Last error time
  last_error      text,                                            -- Last error detail
  connected_by    uuid,                                            -- Connected by
  connected_at    timestamptz,                                     -- Connected time
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE NULLS NOT DISTINCT (tenant_id, provider, external_account_id, user_id),
  CHECK ((scope = 'user') = (user_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, connected_by) REFERENCES users(tenant_id, id)
);

--- table webhook_events | Integrations | Every incoming webhook, stored before processing so nothing is lost and duplicates are ignored.
CREATE TABLE webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Event ID
  tenant_id       uuid REFERENCES tenants(id),                     -- Tenant (empty until matched to an integration)
  integration_id  uuid,                                            -- Matched integration
  provider        text NOT NULL,                                   -- Sending provider
  external_event_id text NOT NULL,                                 -- Provider event ID (deduplication key)
  signature_valid boolean NOT NULL,                                -- Signature check result
  payload         jsonb NOT NULL,                                  -- Raw payload
  status          text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','failed','ignored')), -- Processing status
  attempts        smallint NOT NULL DEFAULT 0,                     -- Processing attempts
  last_error      text,                                            -- Last processing error
  received_at     timestamptz NOT NULL DEFAULT now(),              -- Received time
  processed_at    timestamptz,                                     -- Processed time
  UNIQUE (provider, external_event_id),
  FOREIGN KEY (tenant_id, integration_id) REFERENCES integrations(tenant_id, id)
);

--- table integration_sync_runs | Integrations | Each sync or import run with record counts and errors (shown on the Integrations screen).
CREATE TABLE integration_sync_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Run ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  integration_id  uuid NOT NULL,                                   -- Integration
  job_type        text NOT NULL,                                   -- e.g. lead_intake, spend_import, calendar_sync
  status          text NOT NULL CHECK (status IN ('running','success','partial','failed')), -- Run result
  records_received integer NOT NULL DEFAULT 0,                     -- Records received
  records_created integer NOT NULL DEFAULT 0,                      -- Records created or updated
  records_failed  integer NOT NULL DEFAULT 0,                      -- Records failed
  error_detail    text,                                            -- Error detail
  started_at      timestamptz NOT NULL DEFAULT now(),              -- Start time
  finished_at     timestamptz,                                     -- End time
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, integration_id) REFERENCES integrations(tenant_id, id)
);

-- ======================= LEAD CONFIGURATION =========================

--- table lead_stages | Lead settings | The four fixed lead statuses Hot, Warm, Cold, Sale Done (migration 0006). category drives rules: open, won, lost.
CREATE TABLE lead_stages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Stage ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  key             text NOT NULL CHECK (key ~ '^[a-z_]+$'),         -- Stable key, e.g. no_response
  name            text NOT NULL,                                   -- Display name
  category        text NOT NULL CHECK (category IN ('open','won','lost','invalid')), -- Open or terminal category
  sort_order      smallint NOT NULL,                               -- Order in the status bar
  is_system       boolean NOT NULL DEFAULT false,                  -- Built-in status used by automation (cannot be deleted)
  is_active       boolean NOT NULL DEFAULT true,                   -- Active flag
  color           text NOT NULL DEFAULT '#64748b' CHECK (color ~ '^#[0-9a-fA-F]{6}$'), -- Badge colour
  description     text,                                            -- Shown in Manage Status
  requires_scheduling boolean NOT NULL DEFAULT false,              -- Moving a lead here needs a date and time
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, category),
  UNIQUE (tenant_id, key)
);

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

--- table reasons | Lead settings | Configurable reasons for Lost, Invalid and reassignment.
CREATE TABLE reasons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Reason ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  type            text NOT NULL CHECK (type IN ('lost','invalid','reassignment')), -- Where the reason is used
  key             text CHECK (key ~ '^[a-z_]+$'),                  -- Stable key for system reasons, e.g. no_response
  name            text NOT NULL,                                   -- Display text
  is_active       boolean NOT NULL DEFAULT true,                   -- Active flag
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, type, key),
  UNIQUE (tenant_id, type, name)
);

--- table lead_sources | Lead settings | Where leads come from (Meta, portals, website, import, events...). quality_score feeds lead scoring.
CREATE TABLE lead_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Source ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  type            text NOT NULL CHECK (type IN ('meta','google_ads','linkedin','snapchat','tiktok','website','webhook','property_finder','bayut','dubizzle','whatsapp','import','manual','event','referral','other')), -- Source type
  name            text NOT NULL,                                   -- Display name
  integration_id  uuid,                                            -- Integration that delivers this source
  quality_score   smallint NOT NULL DEFAULT 50 CHECK (quality_score BETWEEN 0 AND 100), -- Source quality used in scoring
  is_active       boolean NOT NULL DEFAULT true,                   -- Active flag
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name),
  FOREIGN KEY (tenant_id, integration_id) REFERENCES integrations(tenant_id, id)
);

--- table campaigns | Marketing | Ad campaigns from Meta, Google, etc., or manual campaigns.
CREATE TABLE campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Campaign ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  source_id       uuid NOT NULL,                                   -- Source / platform
  external_id     text,                                            -- Campaign ID at the platform
  name            text NOT NULL,                                   -- Campaign name
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')), -- Status
  starts_on       date,                                            -- Start date
  ends_on         date,                                            -- End date
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, source_id, external_id),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  FOREIGN KEY (tenant_id, source_id) REFERENCES lead_sources(tenant_id, id)
);

--- table ad_spend_daily | Marketing | Daily ad spend per campaign, imported from ad accounts or entered manually.
CREATE TABLE ad_spend_daily (
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  campaign_id     uuid NOT NULL,                                   -- Campaign
  spend_date      date NOT NULL,                                   -- Day
  amount          numeric(14,2) NOT NULL CHECK (amount >= 0),      -- Spend amount
  currency        char(3) NOT NULL REFERENCES currencies(code),    -- Currency
  entry_method    text NOT NULL CHECK (entry_method IN ('api','manual')), -- Imported or typed
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  PRIMARY KEY (campaign_id, spend_date),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES campaigns(tenant_id, id)
);

--- table events | Marketing | Events and roadshows that leads can be tagged to.
CREATE TABLE events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Event ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  name            text NOT NULL,                                   -- Event name
  type            text NOT NULL CHECK (type IN ('event','roadshow','exhibition','open_house')), -- Event type
  location        text,                                            -- Venue / city
  starts_at       timestamptz NOT NULL,                            -- Start
  ends_at         timestamptz NOT NULL,                            -- End
  cost            numeric(14,2) CHECK (cost >= 0),                 -- Total cost
  currency        char(3) REFERENCES currencies(code),             -- Cost currency
  created_by      uuid,                                            -- Created by
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  CHECK (ends_at >= starts_at),
  CHECK ((cost IS NULL) = (currency IS NULL)),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);

-- ===================== PROJECTS AND INVENTORY =======================

--- table developers | Projects | Property developers (e.g. Emaar, Sobha).
CREATE TABLE developers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Developer ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  name            text NOT NULL,                                   -- Developer name
  trn             text,                                            -- VAT registration number
  contact_name    text,                                            -- Main contact
  email           citext,                                          -- Email
  phone           text,                                            -- Phone (E.164)
  address         text,                                            -- Address
  website         text,                                            -- Website
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

--- table projects | Projects | Real estate projects sold by the brokerage.
CREATE TABLE projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Project ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  developer_id    uuid NOT NULL,                                   -- Developer
  name            text NOT NULL,                                   -- Project name
  community       text,                                            -- Community / area, e.g. Dubai Hills
  city            text NOT NULL DEFAULT 'Dubai',                   -- City
  address         text,                                            -- Address
  latitude        numeric(9,6) CHECK (latitude BETWEEN -90 AND 90),   -- Map latitude
  longitude       numeric(9,6) CHECK (longitude BETWEEN -180 AND 180), -- Map longitude
  description     text,                                            -- Description
  construction_status text NOT NULL DEFAULT 'off_plan' CHECK (construction_status IN ('off_plan','under_construction','ready')), -- Build status
  handover_date   date,                                            -- Expected handover
  payment_plan    text,                                            -- Payment plan, e.g. 80/20
  brochure_file_id uuid,                                           -- Project brochure
  is_active       boolean NOT NULL DEFAULT true,                   -- Active flag
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, developer_id, name),
  FOREIGN KEY (tenant_id, developer_id) REFERENCES developers(tenant_id, id),
  FOREIGN KEY (tenant_id, brochure_file_id) REFERENCES files(tenant_id, id)
);

--- table buildings | Projects | Buildings or phases within a project.
CREATE TABLE buildings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Building ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  project_id      uuid NOT NULL,                                   -- Project
  name            text NOT NULL,                                   -- Building name, e.g. Tower A
  floors          smallint CHECK (floors > 0),                     -- Number of floors
  handover_date   date,                                            -- Building handover date
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, project_id, id),
  UNIQUE (project_id, name),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

--- table units | Projects | Individual units for sale. Status: available, on hold, booked, sold.
CREATE TABLE units (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Unit ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  project_id      uuid NOT NULL,                                   -- Project
  building_id     uuid,                                            -- Building (empty for villas/plots)
  unit_number     text NOT NULL,                                   -- Unit number, e.g. 1204
  property_type   text NOT NULL CHECK (property_type IN ('apartment','villa','townhouse','penthouse','duplex','office','retail','plot')), -- Property type
  bedrooms        smallint NOT NULL CHECK (bedrooms BETWEEN 0 AND 20), -- Bedrooms (0 = studio)
  bathrooms       smallint CHECK (bathrooms BETWEEN 0 AND 20),     -- Bathrooms
  size_sqft       numeric(10,2) NOT NULL CHECK (size_sqft > 0),    -- Size in square feet
  floor           smallint,                                        -- Floor number
  view            text,                                            -- View, e.g. Sea
  price           numeric(14,2) NOT NULL CHECK (price >= 0),       -- Current price
  currency        char(3) NOT NULL DEFAULT 'AED' REFERENCES currencies(code), -- Price currency
  payment_plan    text,                                            -- Unit payment plan (overrides project)
  handover_date   date,                                            -- Unit handover date
  status          text NOT NULL DEFAULT 'available' CHECK (status IN ('available','on_hold','booked','sold')), -- Availability
  hold_expires_at timestamptz,                                     -- When an On Hold status ends
  floor_plan_file_id uuid,                                         -- Floor plan file
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, project_id, id),
  UNIQUE NULLS NOT DISTINCT (project_id, building_id, unit_number),
  CHECK (status = 'on_hold' OR hold_expires_at IS NULL),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  FOREIGN KEY (tenant_id, project_id, building_id) REFERENCES buildings(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, floor_plan_file_id) REFERENCES files(tenant_id, id)
);

--- table unit_changes | Projects | History of every unit price and status change.
CREATE TABLE unit_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Change ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  unit_id         uuid NOT NULL,                                   -- Unit
  old_status      text,                                            -- Status before
  new_status      text,                                            -- Status after
  old_price       numeric(14,2),                                   -- Price before
  new_price       numeric(14,2),                                   -- Price after
  reason          text,                                            -- Why it changed
  changed_by      uuid,                                            -- Changed by (empty = system)
  changed_at      timestamptz NOT NULL DEFAULT now(),              -- Change time
  CHECK (old_status IS DISTINCT FROM new_status OR old_price IS DISTINCT FROM new_price),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id),
  FOREIGN KEY (tenant_id, changed_by) REFERENCES users(tenant_id, id)
);

-- ============================== LEADS ===============================

--- table leads | Leads | One person interested in property. stage_category is kept in step with the stage by a foreign key.
CREATE TABLE leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Lead ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  full_name       text NOT NULL,                                   -- Full name
  phone_primary   text CHECK (phone_primary ~ '^\+[1-9][0-9]{6,14}$'),   -- Primary phone (E.164)
  phone_alternate text CHECK (phone_alternate ~ '^\+[1-9][0-9]{6,14}$'), -- Alternate phone (E.164)
  email           citext,                                          -- Email (case-insensitive)
  country_code    char(2) CHECK (country_code ~ '^[A-Z]{2}$'),     -- Country of residence (ISO)
  preferred_language text,                                         -- Preferred language (ISO 639-1)
  budget_min      numeric(14,2) CHECK (budget_min >= 0),           -- Budget from
  budget_max      numeric(14,2) CHECK (budget_max >= 0),           -- Budget to
  budget_currency char(3) REFERENCES currencies(code),             -- Budget currency
  source_id       uuid NOT NULL,                                   -- Original source
  campaign_id     uuid,                                            -- Original campaign
  event_id        uuid,                                            -- Event or roadshow
  form_name       text,                                            -- Form name of the latest inquiry
  owner_user_id   uuid,                                            -- Responsible agent (empty = Unassigned queue)
  team_id         uuid,                                            -- Owner's team at assignment (for team scope)
  assigned_at     timestamptz,                                     -- When the current owner was assigned
  response_due_at timestamptz,                                     -- Deadline for the owner's first action (10-minute rule); empty once acted
  first_response_at timestamptz,                                   -- Owner's first logged action after assignment
  stage_id        uuid NOT NULL,                                   -- Current stage
  stage_category  text NOT NULL CHECK (stage_category IN ('open','won','lost','invalid')), -- Category of the current stage (kept in step by FK)
  substatus_id    uuid,                                            -- Substatus under the current status (required for Cold)
  close_reason_id uuid,                                            -- Reason (leads closed before migration 0006)
  close_note      text,                                            -- Extra detail for Lost / Invalid
  closed_at       timestamptz,                                     -- When the lead reached a terminal stage
  priority        text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')), -- Agent-set priority
  score           smallint NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100), -- Lead score
  latest_note     text,                                            -- Copy of the latest note (for the list view)
  next_follow_up_at timestamptz,                                   -- Next planned action
  next_appointment_at timestamptz,                                 -- Start of the earliest scheduled appointment (Appointment Date filter)
  last_activity_at  timestamptz,                                   -- Last logged activity of any kind
  last_inbound_at   timestamptz,                                   -- Last reply / inbound contact from the lead
  enquiry_count   integer NOT NULL DEFAULT 1 CHECK (enquiry_count >= 1), -- Number of enquiries (more than 1 = re-enquired)
  last_enquiry_at timestamptz NOT NULL DEFAULT now(),              -- Time of the latest enquiry
  deleted_at      timestamptz,                                     -- Soft delete time
  deleted_by      uuid,                                            -- Deleted by
  created_by      uuid,                                            -- Created by (empty = integration)
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  version         integer NOT NULL DEFAULT 1,                      -- Optimistic lock counter
  UNIQUE (tenant_id, id),
  CHECK (phone_primary IS NOT NULL OR email IS NOT NULL),
  CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_max >= budget_min),
  CHECK ((budget_min IS NULL AND budget_max IS NULL) OR budget_currency IS NOT NULL),
  CONSTRAINT leads_closed_substatus_check CHECK (stage_category NOT IN ('lost','invalid') OR substatus_id IS NOT NULL),
  CHECK ((stage_category = 'open') = (closed_at IS NULL)),
  CHECK (stage_category <> 'open' OR owner_user_id IS NULL OR next_follow_up_at IS NOT NULL OR deleted_at IS NOT NULL),
  CHECK ((owner_user_id IS NULL) = (assigned_at IS NULL)),
  CHECK (response_due_at IS NULL OR owner_user_id IS NOT NULL),
  CHECK (deleted_by IS NULL OR deleted_at IS NOT NULL),
  FOREIGN KEY (tenant_id, source_id) REFERENCES lead_sources(tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES campaigns(tenant_id, id),
  FOREIGN KEY (tenant_id, event_id) REFERENCES events(tenant_id, id),
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id),
  FOREIGN KEY (tenant_id, stage_id, stage_category) REFERENCES lead_stages(tenant_id, id, category),
  CONSTRAINT leads_substatus_fk FOREIGN KEY (tenant_id, substatus_id, stage_id) REFERENCES lead_substatuses(tenant_id, id, stage_id),
  FOREIGN KEY (tenant_id, close_reason_id) REFERENCES reasons(tenant_id, id),
  FOREIGN KEY (tenant_id, deleted_by) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);

--- table lead_inquiries | Leads | Every enquiry received for a lead, with original source IDs and form answers. Never changed after saving.
CREATE TABLE lead_inquiries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Inquiry ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  lead_id         uuid NOT NULL,                                   -- Lead (repeat enquiries are added to the existing lead)
  source_id       uuid NOT NULL,                                   -- Source
  campaign_id     uuid,                                            -- Campaign
  event_id        uuid,                                            -- Event or roadshow
  integration_id  uuid,                                            -- Integration that delivered it
  project_id      uuid,                                            -- Project asked about
  external_campaign_id text,                                       -- Platform campaign ID
  external_adset_id    text,                                       -- Platform ad set ID
  external_ad_id       text,                                       -- Platform ad ID
  external_form_id     text,                                       -- Platform form ID
  external_submission_id text,                                     -- Platform submission / lead ID (prevents double import)
  is_re_enquiry   boolean NOT NULL DEFAULT false,                  -- Matched an existing lead (Re-enquired)
  form_name       text,                                            -- Form name
  form_answers    jsonb NOT NULL DEFAULT '{}',                     -- Original answers exactly as received
  raw_payload     jsonb,                                           -- Full original payload
  submitted_at    timestamptz NOT NULL,                            -- Original submission time at the source
  received_at     timestamptz NOT NULL DEFAULT now(),              -- Time the CRM received it
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, source_id) REFERENCES lead_sources(tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES campaigns(tenant_id, id),
  FOREIGN KEY (tenant_id, event_id) REFERENCES events(tenant_id, id),
  FOREIGN KEY (tenant_id, integration_id) REFERENCES integrations(tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);
CREATE UNIQUE INDEX lead_inquiries_submission_uq ON lead_inquiries (tenant_id, source_id, external_submission_id) WHERE external_submission_id IS NOT NULL;

--- table lead_projects | Leads | Projects a lead is interested in. One can be marked primary (shown in the list).
CREATE TABLE lead_projects (
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  lead_id         uuid NOT NULL,                                   -- Lead
  project_id      uuid NOT NULL,                                   -- Project
  is_primary      boolean NOT NULL DEFAULT false,                  -- Main project of interest
  added_at        timestamptz NOT NULL DEFAULT now(),              -- Linked time
  PRIMARY KEY (lead_id, project_id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);
CREATE UNIQUE INDEX lead_projects_one_primary_uq ON lead_projects (lead_id) WHERE is_primary;

--- table lead_stage_history | Leads | Every stage change (used for the funnel and audit). Never changed after saving.
CREATE TABLE lead_stage_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- History ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  lead_id         uuid NOT NULL,                                   -- Lead
  from_stage_id   uuid,                                            -- Previous stage (empty for the first stage)
  to_stage_id     uuid NOT NULL,                                   -- New stage
  to_substatus_id uuid,                                            -- Substatus chosen with the change
  reason_id       uuid,                                            -- Reason (required for Lost / Invalid)
  note            text,                                            -- Comment
  is_automatic    boolean NOT NULL DEFAULT false,                  -- Changed by automation (auto-close, reopen, booking)
  changed_by      uuid,                                            -- Changed by (empty = system)
  changed_at      timestamptz NOT NULL DEFAULT now(),              -- Change time
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, from_stage_id) REFERENCES lead_stages(tenant_id, id),
  FOREIGN KEY (tenant_id, to_stage_id) REFERENCES lead_stages(tenant_id, id),
  CONSTRAINT lead_stage_history_substatus_fk FOREIGN KEY (tenant_id, to_substatus_id) REFERENCES lead_substatuses(tenant_id, id),
  FOREIGN KEY (tenant_id, reason_id) REFERENCES reasons(tenant_id, id),
  FOREIGN KEY (tenant_id, changed_by) REFERENCES users(tenant_id, id)
);

--- table assignment_rules | Assignment | Rules checked top to bottom to choose the owner of a new lead.
CREATE TABLE assignment_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Rule ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  name            text NOT NULL,                                   -- Rule name
  priority        smallint NOT NULL,                               -- Order (1 = checked first)
  conditions      jsonb NOT NULL DEFAULT '{}',                     -- Match conditions: project_ids, campaign_ids, source_ids, languages, locations
  target_team_id  uuid,                                            -- Round-robin across this team (or across rule members)
  respect_availability boolean NOT NULL DEFAULT true,              -- Skip unavailable / on-leave agents
  last_assigned_user_id uuid,                                      -- Round-robin pointer
  is_active       boolean NOT NULL DEFAULT true,                   -- Active flag
  shift_days      smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}' CHECK (shift_days <@ '{0,1,2,3,4,5,6}'::smallint[] AND cardinality(shift_days) > 0), -- Days the rule works (0 = Sunday)
  shift_start     time,                                            -- Shift start (empty = all day)
  shift_end       time,                                            -- Shift end (empty = all day)
  timezone        text,                                            -- Shift time zone (empty = company time zone)
  rotation_minutes smallint NOT NULL DEFAULT 10 CHECK (rotation_minutes BETWEEN 1 AND 1440), -- Minutes an agent has before the lead rotates
  max_rotations   smallint NOT NULL DEFAULT 3 CHECK (max_rotations BETWEEN 0 AND 50), -- Rotations before the fallback
  fallback        text NOT NULL DEFAULT 'admin' CHECK (fallback IN ('admin','unassigned','user')), -- Where the lead goes after the last rotation
  fallback_user_id uuid,                                           -- Fallback user (fallback = user)
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, priority) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id, target_team_id) REFERENCES teams(tenant_id, id),
  FOREIGN KEY (tenant_id, last_assigned_user_id) REFERENCES users(tenant_id, id),
  CONSTRAINT assignment_rules_shift_check CHECK ((shift_start IS NULL) = (shift_end IS NULL)),
  CONSTRAINT assignment_rules_fallback_user_check CHECK (fallback <> 'user' OR fallback_user_id IS NOT NULL),
  CONSTRAINT assignment_rules_fallback_user_fk FOREIGN KEY (tenant_id, fallback_user_id) REFERENCES users(tenant_id, id)
);

-- Rotation and Dual Lead Ownership (migration 0007); added here because assignment_rules is created after leads.
ALTER TABLE leads
  ADD COLUMN rotation_rule_id uuid,                                -- Rotation rule that assigned the lead (drives its rotation)
  ADD COLUMN rotation_count smallint NOT NULL DEFAULT 0 CHECK (rotation_count >= 0), -- Times the lead rotated to the next agent
  ADD COLUMN secondary_owner_user_id uuid,                         -- Secondary owner (Dual Lead Ownership)
  ADD CONSTRAINT leads_rotation_rule_fk FOREIGN KEY (tenant_id, rotation_rule_id) REFERENCES assignment_rules(tenant_id, id),
  ADD CONSTRAINT leads_secondary_owner_fk FOREIGN KEY (tenant_id, secondary_owner_user_id) REFERENCES users(tenant_id, id),
  ADD CONSTRAINT leads_secondary_owner_check CHECK (secondary_owner_user_id IS NULL OR secondary_owner_user_id IS DISTINCT FROM owner_user_id);
CREATE INDEX leads_secondary_owner_idx ON leads (tenant_id, secondary_owner_user_id) WHERE secondary_owner_user_id IS NOT NULL;

--- table assignment_rule_members | Assignment | Specific agents a rule rotates between (used when no target team is set).
CREATE TABLE assignment_rule_members (
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  rule_id         uuid NOT NULL,                                   -- Rule
  user_id         uuid NOT NULL,                                   -- Agent
  PRIMARY KEY (rule_id, user_id),
  FOREIGN KEY (tenant_id, rule_id) REFERENCES assignment_rules(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);

--- table lead_assignments | Leads | Every owner change: previous owner, new owner, who, when, why. Never changed after saving.
CREATE TABLE lead_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Assignment ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  lead_id         uuid NOT NULL,                                   -- Lead
  from_user_id    uuid,                                            -- Previous owner (empty = was unassigned)
  to_user_id      uuid,                                            -- New owner (empty = moved to Unassigned)
  method          text NOT NULL CHECK (method IN ('manual','round_robin','rule','no_response','admin_fallback','user_deactivated','re_enquiry')), -- How it was assigned (no_response = 10-minute rule; admin_fallback = whole team missed it)
  rule_id         uuid,                                            -- Rule used
  reason_id       uuid,                                            -- Reassignment reason (required for manual reassignment)
  note            text,                                            -- Comment
  changed_by      uuid,                                            -- Changed by (empty = system)
  changed_at      timestamptz NOT NULL DEFAULT now(),              -- Change time
  CHECK (from_user_id IS DISTINCT FROM to_user_id),
  CHECK (method <> 'manual' OR from_user_id IS NULL OR reason_id IS NOT NULL),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, from_user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, to_user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, rule_id) REFERENCES assignment_rules(tenant_id, id),
  FOREIGN KEY (tenant_id, reason_id) REFERENCES reasons(tenant_id, id),
  FOREIGN KEY (tenant_id, changed_by) REFERENCES users(tenant_id, id)
);

--- table lead_shares | Leads | Secondary users who can see (view) or work on (edit) a lead. The owner stays the owner.
CREATE TABLE lead_shares (
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  lead_id         uuid NOT NULL,                                   -- Lead
  user_id         uuid NOT NULL,                                   -- Secondary user
  access          text NOT NULL CHECK (access IN ('view','edit')), -- View only or Can edit
  shared_by       uuid NOT NULL,                                   -- Who shared it (owner or manager)
  shared_at       timestamptz NOT NULL DEFAULT now(),              -- When shared
  PRIMARY KEY (lead_id, user_id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, shared_by) REFERENCES users(tenant_id, id)
);

--- table lead_imports | Leads | Excel / CSV imports: file, column mapping, preview, counts and rejected rows (migration 0004).
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
  duplicate_mode  text NOT NULL DEFAULT 're_enquiry' CHECK (duplicate_mode IN ('re_enquiry','skip','update')), -- Known phone or email: re-enquiry (lead import), skip or update (migration)
  rows_updated    integer NOT NULL DEFAULT 0 CHECK (rows_updated >= 0), -- Existing leads updated (duplicate_mode = update)
  rows_skipped    integer NOT NULL DEFAULT 0 CHECK (rows_skipped >= 0), -- Existing leads left as they were (duplicate_mode = skip)
  attempts        smallint NOT NULL DEFAULT 1 CHECK (attempts >= 1), -- Runs of this batch (a retry never creates duplicates)
  UNIQUE (tenant_id, id),
  CHECK ((status IN ('completed','failed')) = (completed_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, file_id) REFERENCES files(tenant_id, id),
  FOREIGN KEY (tenant_id, source_id) REFERENCES lead_sources(tenant_id, id),
  FOREIGN KEY (tenant_id, rejected_rows_file_id) REFERENCES files(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);
--- table saved_filters | Leads | Saved list filters and column choices, private or shared with a team.
CREATE TABLE saved_filters (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Filter ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  owner_user_id   uuid NOT NULL,                                   -- Created by
  entity          text NOT NULL CHECK (entity IN ('leads','tasks','units','finance_documents','messages','attendance')), -- List it applies to
  name            text NOT NULL,                                   -- Filter name
  filters         jsonb NOT NULL DEFAULT '{}',                     -- Filter values
  columns         jsonb NOT NULL DEFAULT '[]',                     -- Visible columns in order
  sort            jsonb NOT NULL DEFAULT '[]',                     -- Sort order
  shared_team_id  uuid,                                            -- Team it is shared with (empty = private)
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (owner_user_id, entity, name),
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, shared_team_id) REFERENCES teams(tenant_id, id)
);

-- ============================== DEALS ===============================

--- table deals | Deals | A lead's purchase of one unit: offer, EOI, booking and sale.
CREATE TABLE deals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Deal ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  lead_id         uuid NOT NULL,                                   -- Buyer lead
  project_id      uuid NOT NULL,                                   -- Project
  unit_id         uuid,                                            -- Chosen unit (must belong to the project)
  owner_user_id   uuid NOT NULL,                                   -- Agent handling the deal
  stage           text NOT NULL DEFAULT 'offer' CHECK (stage IN ('offer','eoi','booking','sold','cancelled')), -- Deal stage
  currency        char(3) NOT NULL DEFAULT 'AED' REFERENCES currencies(code), -- Deal currency
  offer_price     numeric(14,2) CHECK (offer_price >= 0),          -- Offered price
  offer_date      date,                                            -- Offer date
  eoi_amount      numeric(14,2) CHECK (eoi_amount >= 0),           -- EOI deposit
  eoi_date        date,                                            -- EOI date
  booking_amount  numeric(14,2) CHECK (booking_amount >= 0),       -- Booking amount
  booking_date    date,                                            -- Booking date
  sale_value      numeric(14,2) CHECK (sale_value >= 0),           -- Final sale value
  sale_date       date,                                            -- Sale date
  cancelled_reason text,                                           -- Why the deal was cancelled
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  CHECK (stage <> 'eoi' OR eoi_date IS NOT NULL),
  CHECK (stage NOT IN ('booking','sold') OR (unit_id IS NOT NULL AND booking_date IS NOT NULL)),
  CHECK (stage <> 'sold' OR (sale_value IS NOT NULL AND sale_date IS NOT NULL)),
  CHECK (stage <> 'cancelled' OR cancelled_reason IS NOT NULL),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  FOREIGN KEY (tenant_id, project_id, unit_id) REFERENCES units(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES users(tenant_id, id)
);
CREATE UNIQUE INDEX deals_one_booking_per_unit_uq ON deals (unit_id) WHERE stage IN ('booking','sold');

-- ====================== TASKS AND MEETINGS ==========================

--- table booking_pages | Tasks | Each agent's public booking page (replaces Calendly). Clients pick a free slot from the agent's calendar.
CREATE TABLE booking_pages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Booking page ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  user_id         uuid NOT NULL,                                   -- Agent whose calendar is offered
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,60}$'), -- Public link name, e.g. sara-ali
  title           text NOT NULL,                                   -- Page heading
  meeting_channel text NOT NULL DEFAULT 'google_meet' CHECK (meeting_channel IN ('google_meet','teams','in_person','phone')), -- Default meeting type
  duration_minutes smallint NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 10 AND 240), -- Slot length
  buffer_minutes  smallint NOT NULL DEFAULT 10 CHECK (buffer_minutes >= 0), -- Gap between meetings
  min_notice_hours smallint NOT NULL DEFAULT 2 CHECK (min_notice_hours >= 0), -- Earliest bookable time from now
  weekly_hours    jsonb NOT NULL DEFAULT '{}',                     -- Bookable hours per weekday, e.g. {"mon":[["09:00","17:00"]]}
  is_active       boolean NOT NULL DEFAULT true,                   -- Page on / off
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
);

--- table meetings | Tasks | Online meetings (Google Meet / Teams) and property viewings. The database blocks double booking of an agent.
CREATE TABLE meetings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Meeting ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  lead_id         uuid NOT NULL,                                   -- Lead
  organizer_user_id uuid NOT NULL,                                 -- Agent attending
  type            text NOT NULL CONSTRAINT meetings_type_check CHECK (type IN ('meeting','viewing','call','event')), -- Call, Zoom / online meeting, event or property viewing
  channel         text NOT NULL CONSTRAINT meetings_channel_check CHECK (channel IN ('google_meet','teams','in_person','phone','online_link')), -- How it happens (online_link: a link the agent pastes, e.g. Zoom)
  booked_via      text NOT NULL DEFAULT 'agent' CHECK (booked_via IN ('agent','booking_page')), -- Booked by the agent or by the client on the booking page
  booking_page_id uuid,                                            -- Booking page used by the client
  external_meeting_id text,                                        -- Google Meet / Teams meeting ID
  join_url        text,                                            -- Online meeting link
  location        text,                                            -- Address for in-person / viewing
  project_id      uuid,                                            -- Project shown
  unit_id         uuid,                                            -- Unit shown
  deal_id         uuid,                                            -- Related deal
  starts_at       timestamptz NOT NULL,                            -- Start
  ends_at         timestamptz NOT NULL,                            -- End
  client_timezone text NOT NULL DEFAULT 'Asia/Dubai',              -- Client time zone for messages
  status          text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')), -- Status
  cancel_reason   text,                                            -- Cancellation reason
  notes           text,                                            -- Agent's notes for the appointment
  reschedule_count smallint NOT NULL DEFAULT 0,                    -- Times rescheduled
  created_by      uuid,                                            -- Created by (empty = client via booking page)
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  CHECK (ends_at > starts_at),
  CHECK (channel IN ('in_person','phone') OR join_url IS NOT NULL OR status = 'cancelled'),
  CHECK ((booked_via = 'booking_page') = (booking_page_id IS NOT NULL)),
  EXCLUDE USING gist (organizer_user_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status = 'scheduled'),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, organizer_user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deals(tenant_id, id),
  FOREIGN KEY (tenant_id, booking_page_id) REFERENCES booking_pages(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);

--- table tasks | Tasks | Calls, follow-ups, meetings, viewings and personal tasks with reminders and outcomes.
CREATE TABLE tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Task ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  lead_id         uuid,                                            -- Lead (empty for personal tasks)
  assigned_user_id uuid NOT NULL,                                  -- Responsible user
  type            text NOT NULL CHECK (type IN ('call','follow_up','meeting','viewing','personal')), -- Task type
  title           text NOT NULL,                                   -- Title
  description     text,                                            -- Details
  due_at          timestamptz NOT NULL,                            -- Due date and time
  duration_minutes smallint CHECK (duration_minutes > 0),          -- Planned duration
  reminder_minutes smallint CHECK (reminder_minutes >= 0),         -- Remind this many minutes before
  meeting_id      uuid,                                            -- Linked meeting / viewing
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')), -- Status
  outcome         text CHECK (outcome IN ('answered','no_answer','busy','wrong_number','call_back')), -- Call outcome
  outcome_note    text,                                            -- Outcome note
  completed_at    timestamptz,                                     -- Completed time
  completed_by    uuid,                                            -- Completed by
  next_task_id    uuid,                                            -- Follow-up task created on completion
  reminded_at     timestamptz,                                     -- Reminder sent time
  overdue_alerted_at timestamptz,                                  -- Overdue alert sent time
  created_by      uuid,                                            -- Created by (empty = system)
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK (type <> 'call' OR status <> 'completed' OR outcome IS NOT NULL),
  CHECK (outcome IS NULL OR type = 'call'),
  CHECK (type = 'personal' OR lead_id IS NOT NULL),
  CHECK (next_task_id IS DISTINCT FROM id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, assigned_user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES meetings(tenant_id, id),
  FOREIGN KEY (tenant_id, completed_by) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, next_task_id) REFERENCES tasks(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);

--- table calendar_event_links | Tasks | Links a meeting or task to the event copy in a user's Google / Microsoft calendar.
CREATE TABLE calendar_event_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Link ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  integration_id  uuid NOT NULL,                                   -- User's calendar connection
  meeting_id      uuid,                                            -- Linked meeting
  task_id         uuid,                                            -- Linked task
  external_event_id text NOT NULL,                                 -- Event ID in the calendar
  etag            text,                                            -- Version tag for change detection
  synced_at       timestamptz NOT NULL DEFAULT now(),              -- Last sync
  UNIQUE (integration_id, external_event_id),
  CHECK (num_nonnulls(meeting_id, task_id) = 1),
  FOREIGN KEY (tenant_id, integration_id) REFERENCES integrations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES meetings(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, task_id) REFERENCES tasks(tenant_id, id) ON DELETE CASCADE
);

-- ========================= MESSAGING ================================

--- table message_templates | Messaging | Approved WhatsApp templates and email templates.
CREATE TABLE message_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Template ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  channel         text NOT NULL CHECK (channel IN ('whatsapp','email')), -- Channel
  name            text NOT NULL,                                   -- Template name (provider name for WhatsApp)
  language        text NOT NULL DEFAULT 'en',                      -- Language code
  category        text NOT NULL CHECK (category IN ('marketing','utility','authentication','transactional')), -- Meta category / email type
  subject         text,                                            -- Email subject
  body            text NOT NULL,                                   -- Body with {{placeholders}}
  variables       jsonb NOT NULL DEFAULT '[]',                     -- Placeholder definitions
  integration_id  uuid,                                            -- WhatsApp number / provider it is registered with
  provider_template_id text,                                       -- Template ID at the provider
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected','disabled')), -- Approval status
  created_by      uuid,                                            -- Created by
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, channel, name, language),
  CHECK (channel <> 'email' OR subject IS NOT NULL),
  FOREIGN KEY (tenant_id, integration_id) REFERENCES integrations(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);

--- table message_campaigns | Messaging | Bulk WhatsApp / email campaigns with test, approval and schedule.
CREATE TABLE message_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Campaign ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  name            text NOT NULL,                                   -- Campaign name
  channel         text NOT NULL CHECK (channel IN ('whatsapp','email')), -- Channel
  template_id     uuid NOT NULL,                                   -- Template
  integration_id  uuid NOT NULL,                                   -- Sending number / mailbox
  audience_filter jsonb NOT NULL,                                  -- Lead filter that defines the audience
  audience_count  integer,                                         -- Recipients after opt-out exclusion
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','rejected','sending','completed','cancelled')), -- Status
  scheduled_at    timestamptz,                                     -- Planned send time
  test_sent_at    timestamptz,                                     -- Test message sent time
  test_recipient  text,                                            -- Test phone / email
  created_by      uuid NOT NULL,                                   -- Created by
  approved_by     uuid,                                            -- Approved / rejected by
  approved_at     timestamptz,                                     -- Approval time
  rejection_note  text,                                            -- Rejection reason
  started_at      timestamptz,                                     -- Sending started
  completed_at    timestamptz,                                     -- Sending finished
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  CHECK (status NOT IN ('approved','sending','completed') OR approved_by IS NOT NULL),
  CHECK (status <> 'rejected' OR rejection_note IS NOT NULL),
  CHECK (approved_by IS DISTINCT FROM created_by OR approved_by IS NULL),
  FOREIGN KEY (tenant_id, template_id) REFERENCES message_templates(tenant_id, id),
  FOREIGN KEY (tenant_id, integration_id) REFERENCES integrations(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES users(tenant_id, id)
);

--- table conversations | Messaging | One WhatsApp or email thread per lead, channel and sending account.
CREATE TABLE conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Conversation ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  lead_id         uuid NOT NULL,                                   -- Lead
  channel         text NOT NULL CHECK (channel IN ('whatsapp','email')), -- Channel
  integration_id  uuid NOT NULL,                                   -- Our number / mailbox
  contact_address text NOT NULL,                                   -- Lead's phone (E.164) or email
  last_message_at timestamptz,                                     -- Last message time
  last_inbound_at timestamptz,                                     -- Last message from the lead (opens the 24 h WhatsApp window)
  unread_count    integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0), -- Unread inbound messages
  UNIQUE (tenant_id, id),
  UNIQUE (integration_id, contact_address),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, integration_id) REFERENCES integrations(tenant_id, id)
);

--- table messages | Messaging | Every WhatsApp and email message, in and out, with delivery status.
CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Message ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  conversation_id uuid NOT NULL,                                   -- Conversation
  lead_id         uuid NOT NULL,                                   -- Lead (copied for fast timeline queries)
  direction       text NOT NULL CHECK (direction IN ('inbound','outbound')), -- In or out
  template_id     uuid,                                            -- Template used
  campaign_id     uuid,                                            -- Bulk campaign it belongs to
  subject         text,                                            -- Email subject
  body            text,                                            -- Text body
  media_file_id   uuid,                                            -- Attachment / media
  provider_message_id text,                                        -- Message ID at the provider
  status          text NOT NULL CHECK (status IN ('queued','sent','delivered','read','failed','received')), -- Delivery status (queued = attempted)
  error_code      text,                                            -- Provider error code
  error_message   text,                                            -- Provider error text
  sent_by         uuid,                                            -- Sending user (empty = system / campaign)
  sent_at         timestamptz,                                     -- Sent time
  delivered_at    timestamptz,                                     -- Delivered time
  read_at         timestamptz,                                     -- Read time
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  UNIQUE (tenant_id, id),
  CHECK ((direction = 'inbound') = (status = 'received')),
  CHECK (body IS NOT NULL OR media_file_id IS NOT NULL OR template_id IS NOT NULL),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, template_id) REFERENCES message_templates(tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES message_campaigns(tenant_id, id),
  FOREIGN KEY (tenant_id, media_file_id) REFERENCES files(tenant_id, id),
  FOREIGN KEY (tenant_id, sent_by) REFERENCES users(tenant_id, id)
);
CREATE UNIQUE INDEX messages_provider_id_uq ON messages (conversation_id, provider_message_id) WHERE provider_message_id IS NOT NULL;

--- table message_campaign_recipients | Messaging | Each lead in a bulk campaign and what happened to its message.
CREATE TABLE message_campaign_recipients (
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  campaign_id     uuid NOT NULL,                                   -- Campaign
  lead_id         uuid NOT NULL,                                   -- Recipient lead
  address         text NOT NULL,                                   -- Phone or email used
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','skipped_opted_out','sent','delivered','failed','replied','opted_out')), -- Result
  message_id      uuid,                                            -- Message sent
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last status change
  PRIMARY KEY (campaign_id, lead_id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES message_campaigns(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES messages(tenant_id, id)
);

--- table consents | Messaging | Consent and opt-out history per lead and channel. Latest row wins. Never changed after saving.
CREATE TABLE consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Consent record ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  lead_id         uuid NOT NULL,                                   -- Lead
  channel         text NOT NULL CHECK (channel IN ('whatsapp','email','sms')), -- Channel
  status          text NOT NULL CHECK (status IN ('opted_in','opted_out')), -- Consent given or withdrawn
  capture_method  text NOT NULL CHECK (capture_method IN ('form','import','reply','unsubscribe_link','manual','provider')), -- How it was captured
  note            text,                                            -- Evidence / comment
  recorded_by     uuid,                                            -- Recorded by (empty = system)
  recorded_at     timestamptz NOT NULL DEFAULT now(),              -- Time recorded
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES users(tenant_id, id)
);

-- ============================ FINANCE ===============================

--- table counterparties | Finance | Who a financial document is with: client, developer or vendor.
CREATE TABLE counterparties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Counterparty ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  type            text NOT NULL CHECK (type IN ('client','developer','vendor')), -- Kind
  name            text NOT NULL,                                   -- Name on documents
  trn             text,                                            -- VAT registration number
  email           citext,                                          -- Billing email
  phone           text,                                            -- Phone
  address         text,                                            -- Billing address
  lead_id         uuid,                                            -- Linked lead (clients)
  developer_id    uuid,                                            -- Linked developer (developers)
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  CHECK (type = 'client' OR lead_id IS NULL),
  CHECK ((type = 'developer') = (developer_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, developer_id) REFERENCES developers(tenant_id, id)
);

--- table document_sequences | Finance | Next document number per type (e.g. INV-2026-0042).
CREATE TABLE document_sequences (
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  doc_type        text NOT NULL CHECK (doc_type IN ('sales_invoice','purchase_invoice','purchase_order')), -- Document type
  prefix          text NOT NULL,                                   -- Prefix, e.g. INV-
  include_year    boolean NOT NULL DEFAULT true,                   -- Add the year and restart each year
  padding         smallint NOT NULL DEFAULT 4 CHECK (padding BETWEEN 1 AND 10), -- Digits, e.g. 4 = 0042
  current_year    smallint,                                        -- Year of the counter (when include_year)
  next_number     integer NOT NULL DEFAULT 1 CHECK (next_number > 0), -- Next number to issue
  PRIMARY KEY (tenant_id, doc_type)
);

--- table finance_documents | Finance | Sales invoices, purchase invoices and purchase orders.
CREATE TABLE finance_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Document ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  doc_type        text NOT NULL CHECK (doc_type IN ('sales_invoice','purchase_invoice','purchase_order')), -- Type
  number          text,                                            -- Document number (given on approval; empty while Draft)
  counterparty_id uuid NOT NULL,                                   -- Client, developer or vendor
  lead_id         uuid,                                            -- Linked lead
  project_id      uuid,                                            -- Linked project
  unit_id         uuid,                                            -- Linked unit
  deal_id         uuid,                                            -- Linked deal
  purchase_order_id uuid,                                          -- PO this purchase invoice settles
  issue_date      date NOT NULL,                                   -- Issue date
  due_date        date,                                            -- Due date
  currency        char(3) NOT NULL REFERENCES currencies(code),    -- Currency
  rate_to_base    numeric(18,8) NOT NULL DEFAULT 1 CHECK (rate_to_base > 0), -- Exchange rate to base currency at issue
  subtotal        numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0), -- Sum of lines before tax
  tax_total       numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0), -- Sum of line tax
  total           numeric(14,2) GENERATED ALWAYS AS (subtotal + tax_total) STORED, -- Total incl. tax
  amount_paid     numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0), -- Payments received / made
  amount_refunded numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0), -- Refunds
  balance         numeric(14,2) GENERATED ALWAYS AS (subtotal + tax_total - amount_paid + amount_refunded) STORED, -- Outstanding amount
  payment_terms   text,                                            -- Payment terms
  notes           text,                                            -- Notes printed on the document
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','partially_paid','paid','overdue','cancelled','refunded')), -- Status
  pdf_file_id     uuid,                                            -- Generated PDF
  created_by      uuid NOT NULL,                                   -- Created by
  approved_by     uuid,                                            -- Approved by
  approved_at     timestamptz,                                     -- Approval time
  sent_at         timestamptz,                                     -- Sent time
  cancelled_by    uuid,                                            -- Cancelled by
  cancelled_at    timestamptz,                                     -- Cancellation time
  cancel_reason   text,                                            -- Cancellation reason
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  version         integer NOT NULL DEFAULT 1,                      -- Optimistic lock counter
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, doc_type, number),
  CHECK (due_date IS NULL OR due_date >= issue_date),
  CHECK (doc_type <> 'purchase_order' OR status IN ('draft','approved','sent','cancelled')),
  CHECK (status = 'draft' OR (number IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL),
  CHECK (purchase_order_id IS NULL OR doc_type = 'purchase_invoice'),
  CHECK (purchase_order_id IS DISTINCT FROM id),
  FOREIGN KEY (tenant_id, counterparty_id) REFERENCES counterparties(tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deals(tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES finance_documents(tenant_id, id),
  FOREIGN KEY (tenant_id, pdf_file_id) REFERENCES files(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, cancelled_by) REFERENCES users(tenant_id, id)
);

--- table finance_document_lines | Finance | Line items of a financial document. Can only change while the document is Draft.
CREATE TABLE finance_document_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Line ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  document_id     uuid NOT NULL,                                   -- Document
  line_no         smallint NOT NULL CHECK (line_no > 0),           -- Line order
  description     text NOT NULL,                                   -- Description
  quantity        numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0), -- Quantity
  unit_price      numeric(14,2) NOT NULL CHECK (unit_price >= 0),  -- Price per unit before tax
  tax_rate        numeric(5,2) NOT NULL DEFAULT 5.00 CHECK (tax_rate BETWEEN 0 AND 100), -- VAT % (UAE standard 5)
  line_subtotal   numeric(14,2) NOT NULL CHECK (line_subtotal >= 0), -- quantity × unit_price, rounded
  tax_amount      numeric(14,2) NOT NULL CHECK (tax_amount >= 0),  -- line_subtotal × tax_rate, rounded
  UNIQUE (document_id, line_no),
  FOREIGN KEY (tenant_id, document_id) REFERENCES finance_documents(tenant_id, id) ON DELETE CASCADE
);

--- table payments | Finance | Payments and refunds recorded against a document.
CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Payment ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  document_id     uuid NOT NULL,                                   -- Document
  kind            text NOT NULL CHECK (kind IN ('payment','refund')), -- Payment or refund
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),       -- Amount (always positive)
  currency        char(3) NOT NULL REFERENCES currencies(code),    -- Currency (same as document)
  paid_on         date NOT NULL,                                   -- Date of payment
  method          text NOT NULL CHECK (method IN ('bank_transfer','cheque','card','cash','other')), -- Method
  reference       text,                                            -- Bank / cheque reference
  notes           text,                                            -- Notes
  proof_file_id   uuid,                                            -- Receipt / proof
  recorded_by     uuid NOT NULL,                                   -- Recorded by
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Recorded time
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES finance_documents(tenant_id, id),
  FOREIGN KEY (tenant_id, proof_file_id) REFERENCES files(tenant_id, id),
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES users(tenant_id, id)
);

--- table finance_document_events | Finance | Approval and status history of each document. Never changed after saving.
CREATE TABLE finance_document_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Event ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  document_id     uuid NOT NULL,                                   -- Document
  action          text NOT NULL CHECK (action IN ('created','edited','approved','sent','payment_recorded','refund_recorded','overdue','cancelled','pdf_generated')), -- What happened
  from_status     text,                                            -- Status before
  to_status       text,                                            -- Status after
  payment_id      uuid,                                            -- Related payment
  actor_user_id   uuid,                                            -- Who (empty = system)
  note            text,                                            -- Comment
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Time
  FOREIGN KEY (tenant_id, document_id) REFERENCES finance_documents(tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES users(tenant_id, id)
);

--- table commissions | Finance | Agent commission per deal, with the developer commission invoice.
CREATE TABLE commissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Commission ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  deal_id         uuid NOT NULL,                                   -- Deal
  user_id         uuid NOT NULL,                                   -- Agent earning it
  basis           text NOT NULL CHECK (basis IN ('percentage','fixed')), -- Calculation basis
  rate            numeric(6,3) CHECK (rate BETWEEN 0 AND 100),     -- % of sale value (percentage basis)
  amount          numeric(14,2) NOT NULL CHECK (amount >= 0),      -- Commission amount
  currency        char(3) NOT NULL REFERENCES currencies(code),    -- Currency
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','cancelled')), -- Status
  developer_invoice_id uuid,                                       -- Sales invoice to the developer
  approved_by     uuid,                                            -- Approved by
  approved_at     timestamptz,                                     -- Approval time
  paid_on         date,                                            -- Paid date
  notes           text,                                            -- Notes
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (deal_id, user_id),
  CHECK ((basis = 'percentage') = (rate IS NOT NULL)),
  CHECK (status NOT IN ('approved','paid') OR approved_by IS NOT NULL),
  CHECK ((status = 'paid') = (paid_on IS NOT NULL)),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deals(tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, developer_invoice_id) REFERENCES finance_documents(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES users(tenant_id, id)
);

-- ===================== TIMELINE AND ATTACHMENTS =====================

--- table activities | Leads | The lead timeline: one row per event (note, call, message, meeting, stage change, invoice...). Typed links point to the source row.
CREATE TABLE activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Activity ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  lead_id         uuid NOT NULL,                                   -- Lead
  type            text NOT NULL CHECK (type IN ('inquiry','note','call','stage_change','owner_change','whatsapp','email','meeting','viewing','attachment','deal','eoi','booking','invoice','purchase_order','payment','re_enquiry','share','system')), -- Event type
  summary         text NOT NULL,                                   -- One-line text shown on the timeline
  body            text,                                            -- Full text (notes)
  actor_user_id   uuid,                                            -- Who did it (empty = system / lead)
  inquiry_id      uuid,                                            -- Related inquiry
  task_id         uuid,                                            -- Related task / call
  meeting_id      uuid,                                            -- Related meeting
  message_id      uuid,                                            -- Related message
  file_id         uuid,                                            -- Related file
  deal_id         uuid,                                            -- Related deal
  finance_document_id uuid,                                        -- Related invoice / PO
  payment_id      uuid,                                            -- Related payment
  occurred_at     timestamptz NOT NULL DEFAULT now(),              -- When it happened
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Recorded time
  CHECK (type <> 'note' OR body IS NOT NULL),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, inquiry_id) REFERENCES lead_inquiries(tenant_id, id),
  FOREIGN KEY (tenant_id, task_id) REFERENCES tasks(tenant_id, id),
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES meetings(tenant_id, id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES messages(tenant_id, id),
  FOREIGN KEY (tenant_id, file_id) REFERENCES files(tenant_id, id),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deals(tenant_id, id),
  FOREIGN KEY (tenant_id, finance_document_id) REFERENCES finance_documents(tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id)
);

--- table attachments | Shared | Links a file to exactly one record: lead, project, unit, deal, financial document or commission.
CREATE TABLE attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Attachment ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  file_id         uuid NOT NULL,                                   -- File
  category        text NOT NULL CHECK (category IN ('document','image','brochure','floor_plan','contract','id_document','receipt','other')), -- What the file is
  lead_id         uuid,                                            -- Attached to lead
  project_id      uuid,                                            -- Attached to project
  unit_id         uuid,                                            -- Attached to unit
  deal_id         uuid,                                            -- Attached to deal
  finance_document_id uuid,                                        -- Attached to invoice / PO
  commission_id   uuid,                                            -- Attached to commission
  sort_order      smallint NOT NULL DEFAULT 0,                     -- Display order (image galleries)
  created_by      uuid,                                            -- Attached by
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Attached time
  CHECK (num_nonnulls(lead_id, project_id, unit_id, deal_id, finance_document_id, commission_id) = 1),
  FOREIGN KEY (tenant_id, file_id) REFERENCES files(tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deals(tenant_id, id),
  FOREIGN KEY (tenant_id, finance_document_id) REFERENCES finance_documents(tenant_id, id),
  FOREIGN KEY (tenant_id, commission_id) REFERENCES commissions(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);

--- table idempotency_keys | Shared | Idempotency-Key storage: a retried POST with the same key returns the first result (migration 0002).
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

-- ========================= NOTIFICATIONS ============================

--- table notifications | Notifications | In-app notifications (reminders, escalations, assignments). Also sent as push.
CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Notification ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  user_id         uuid NOT NULL,                                   -- Recipient
  type            text NOT NULL,                                   -- e.g. lead_assigned, lead_re_enquired, lead_no_response, lead_admin_fallback, lead_shared, task_due, task_overdue, export_ready
  title           text NOT NULL,                                   -- Title
  body            text,                                            -- Text
  lead_id         uuid,                                            -- Related lead
  link_path       text,                                            -- Screen to open
  push_sent_at    timestamptz,                                     -- Push sent time
  read_at         timestamptz,                                     -- Read time
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id)
);

--- table push_devices | Notifications | Phones and browsers registered for push notifications.
CREATE TABLE push_devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Device ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  user_id         uuid NOT NULL,                                   -- User
  fcm_token       text NOT NULL UNIQUE,                            -- Firebase token
  platform        text NOT NULL CHECK (platform IN ('android','ios','web')), -- Device type
  last_seen_at    timestamptz NOT NULL DEFAULT now(),              -- Last used
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
);

-- =========================== ATTENDANCE =============================

--- table attendance_policies | Attendance | Office hours, grace time, weekends and location rules.
CREATE TABLE attendance_policies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Policy ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  name            text NOT NULL,                                   -- Policy name
  work_start      time NOT NULL,                                   -- Office start, e.g. 09:00
  work_end        time NOT NULL,                                   -- Office end, e.g. 18:00
  grace_minutes   smallint NOT NULL DEFAULT 10 CHECK (grace_minutes >= 0), -- Late after start + grace
  half_day_max_minutes smallint NOT NULL DEFAULT 300 CHECK (half_day_max_minutes > 0), -- Worked minutes at or below this = Half Day
  weekend_days    smallint[] NOT NULL DEFAULT '{0,6}',             -- Weekend days (0 = Sunday … 6 = Saturday)
  location_required boolean NOT NULL DEFAULT false,                -- Record location at check-in
  office_latitude numeric(9,6),                                    -- Office location
  office_longitude numeric(9,6),                                   -- Office location
  office_radius_m integer CHECK (office_radius_m > 0),             -- Allowed distance from office
  is_default      boolean NOT NULL DEFAULT false,                  -- Used when a user has no override
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name),
  CHECK (work_end > work_start),
  CHECK (weekend_days <@ '{0,1,2,3,4,5,6}'::smallint[])
);
CREATE UNIQUE INDEX attendance_policies_one_default_uq ON attendance_policies (tenant_id) WHERE is_default;
ALTER TABLE users ADD FOREIGN KEY (tenant_id, attendance_policy_id) REFERENCES attendance_policies(tenant_id, id);

--- table holidays | Attendance | Public and company holidays.
CREATE TABLE holidays (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Holiday ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  holiday_date    date NOT NULL,                                   -- Date
  name            text NOT NULL,                                   -- Name
  UNIQUE (tenant_id, holiday_date)
);

--- table leave_types | Attendance | Kinds of leave and yearly allowance.
CREATE TABLE leave_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Leave type ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  name            text NOT NULL,                                   -- e.g. Annual, Sick
  annual_days     numeric(5,1) CHECK (annual_days >= 0),           -- Allowance per year (empty = unlimited)
  is_paid         boolean NOT NULL DEFAULT true,                   -- Paid leave
  is_active       boolean NOT NULL DEFAULT true,                   -- Active flag
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

--- table leave_requests | Attendance | Leave requests and approvals. Approved leave makes the user unavailable for new leads.
CREATE TABLE leave_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Request ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  user_id         uuid NOT NULL,                                   -- Employee
  leave_type_id   uuid NOT NULL,                                   -- Leave type
  start_date      date NOT NULL,                                   -- First day
  end_date        date NOT NULL,                                   -- Last day
  is_half_day     boolean NOT NULL DEFAULT false,                  -- Half-day leave (start_date only)
  reason          text,                                            -- Reason
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')), -- Status
  reviewed_by     uuid,                                            -- Approved / rejected by
  reviewed_at     timestamptz,                                     -- Review time
  review_note     text,                                            -- Reviewer comment
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Requested time
  UNIQUE (tenant_id, id),
  CHECK (end_date >= start_date),
  CHECK (NOT is_half_day OR end_date = start_date),
  CHECK (status NOT IN ('approved','rejected') OR reviewed_by IS NOT NULL),
  CHECK (reviewed_by IS DISTINCT FROM user_id OR reviewed_by IS NULL),
  EXCLUDE USING gist (user_id WITH =, daterange(start_date, end_date, '[]') WITH &&) WHERE (status = 'approved'),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, leave_type_id) REFERENCES leave_types(tenant_id, id),
  FOREIGN KEY (tenant_id, reviewed_by) REFERENCES users(tenant_id, id)
);

--- table attendance_records | Attendance | One row per employee per working day, with check-in/out photo, time and location.
CREATE TABLE attendance_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Record ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  user_id         uuid NOT NULL,                                   -- Employee
  work_date       date NOT NULL,                                   -- Working day
  status          text NOT NULL CHECK (status IN ('present','late','absent','leave','half_day','wfh')), -- Day status
  check_in_at     timestamptz,                                     -- Check-in time
  check_in_photo_file_id uuid,                                     -- Check-in live photo
  check_in_latitude  numeric(9,6),                                 -- Check-in location (if enabled)
  check_in_longitude numeric(9,6),                                 -- Check-in location (if enabled)
  check_out_at    timestamptz,                                     -- Check-out time
  check_out_photo_file_id uuid,                                    -- Check-out live photo
  check_out_latitude  numeric(9,6),                                -- Check-out location (if enabled)
  check_out_longitude numeric(9,6),                                -- Check-out location (if enabled)
  leave_request_id uuid,                                           -- Approved leave covering this day
  source          text NOT NULL DEFAULT 'app' CHECK (source IN ('app','system','correction')), -- How the row was last set
  is_corrected    boolean NOT NULL DEFAULT false,                  -- Changed by an approved correction
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  UNIQUE (user_id, work_date),
  CHECK (check_out_at IS NULL OR (check_in_at IS NOT NULL AND check_out_at > check_in_at)),
  CHECK (source <> 'app' OR check_in_at IS NULL OR check_in_photo_file_id IS NOT NULL),
  CHECK (status <> 'leave' OR leave_request_id IS NOT NULL),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, check_in_photo_file_id) REFERENCES files(tenant_id, id),
  FOREIGN KEY (tenant_id, check_out_photo_file_id) REFERENCES files(tenant_id, id),
  FOREIGN KEY (tenant_id, leave_request_id) REFERENCES leave_requests(tenant_id, id)
);

--- table attendance_corrections | Attendance | Correction requests. The original values are kept in original_values; the record keeps the corrected values.
CREATE TABLE attendance_corrections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Correction ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  record_id       uuid NOT NULL,                                   -- Attendance record
  requested_by    uuid NOT NULL,                                   -- Employee asking
  original_values jsonb NOT NULL,                                  -- Copy of the record before correction
  requested_status text NOT NULL CHECK (requested_status IN ('present','late','absent','leave','half_day','wfh')), -- Requested status
  requested_check_in_at  timestamptz,                              -- Requested check-in time
  requested_check_out_at timestamptz,                              -- Requested check-out time
  reason          text NOT NULL,                                   -- Why
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), -- Review status
  reviewed_by     uuid,                                            -- Manager who reviewed
  reviewed_at     timestamptz,                                     -- Review time
  review_note     text,                                            -- Manager comment
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Requested time
  CHECK ((status = 'pending') = (reviewed_at IS NULL)),
  CHECK (status = 'pending' OR reviewed_by IS NOT NULL),
  CHECK (reviewed_by IS DISTINCT FROM requested_by OR reviewed_by IS NULL),
  FOREIGN KEY (tenant_id, record_id) REFERENCES attendance_records(tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, reviewed_by) REFERENCES users(tenant_id, id)
);

-- ========================= REPORTS AND AUDIT ========================

--- table reconciliation_runs | Reports | Meta lead reconciliation: leads at the source vs leads in the CRM, and missing IDs.
CREATE TABLE reconciliation_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Run ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  integration_id  uuid NOT NULL,                                   -- Ad account checked
  period_start    timestamptz NOT NULL,                            -- Period from
  period_end      timestamptz NOT NULL,                            -- Period to
  source_count    integer NOT NULL CHECK (source_count >= 0),      -- Leads at the source
  crm_count       integer NOT NULL CHECK (crm_count >= 0),         -- Leads found in the CRM
  missing_external_ids text[] NOT NULL DEFAULT '{}',               -- Source lead IDs not in the CRM
  recovered_count integer NOT NULL DEFAULT 0 CHECK (recovered_count >= 0), -- Missing leads re-imported
  status          text NOT NULL CHECK (status IN ('running','completed','failed')), -- Run status
  error_detail    text,                                            -- Sync error detail
  run_by          uuid,                                            -- Started by (empty = nightly job)
  started_at      timestamptz NOT NULL DEFAULT now(),              -- Start
  finished_at     timestamptz,                                     -- End
  CHECK (period_end > period_start),
  FOREIGN KEY (tenant_id, integration_id) REFERENCES integrations(tenant_id, id),
  FOREIGN KEY (tenant_id, run_by) REFERENCES users(tenant_id, id)
);

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

--- table export_logs | Reports | Every export: who, which report, filters, format, rows, when.
CREATE TABLE export_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Export ID
  tenant_id       uuid NOT NULL,                                   -- Owning tenant
  user_id         uuid NOT NULL,                                   -- Exported by
  report_key      text NOT NULL,                                   -- Report, e.g. lead_master
  filters         jsonb NOT NULL DEFAULT '{}',                     -- Filters applied
  format          text NOT NULL CHECK (format IN ('xlsx','csv')),  -- File format
  status          text NOT NULL DEFAULT 'queued' CONSTRAINT export_logs_status_check CHECK (status IN ('queued','running','completed','failed','expired')), -- Status
  row_count       integer CHECK (row_count >= 0),                  -- Rows exported
  scope           text CHECK (scope IN ('selected','filtered')),   -- List exports: selected rows or all filtered rows
  columns         text[] NOT NULL DEFAULT '{}',                    -- List exports: columns in order
  file_name       text,                                            -- Name of the generated file
  download_count  integer NOT NULL DEFAULT 0 CHECK (download_count >= 0), -- Times downloaded
  expires_at      timestamptz,                                     -- After this the file can no longer be downloaded
  file_id         uuid,                                            -- Generated file
  error_detail    text,                                            -- Failure detail
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Requested time
  completed_at    timestamptz,                                     -- Completed time
  CHECK (status <> 'completed' OR (file_id IS NOT NULL AND row_count IS NOT NULL)),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, file_id) REFERENCES files(tenant_id, id)
);

--- table audit_logs | Audit | Who changed what and when, with before/after values. Never changed after saving.
CREATE TABLE audit_logs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- Audit ID (ordered)
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  user_id         uuid,                                            -- Acting user (empty = system)
  action          text NOT NULL CHECK (action IN ('create','update','delete','restore','merge','login','login_failed','logout','export','approve','cancel','permission_change','setting_change')), -- Action
  entity_type     text NOT NULL,                                   -- Table / entity name, e.g. leads
  entity_id       uuid,                                            -- Row ID
  changes         jsonb,                                           -- Changed fields: {"field": [old, new]}
  ip_address      inet,                                            -- Client IP
  user_agent      text,                                            -- Client browser
  request_id      text,                                            -- Request trace ID
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Time
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);

-- ===================== SUBSCRIPTIONS & BILLING ======================

--- table subscriptions | Billing | Each tenant's current plan, seats, billing cycle and billing status (one per tenant).
CREATE TABLE subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Subscription ID
  tenant_id       uuid NOT NULL UNIQUE REFERENCES tenants(id),     -- Tenant (one subscription each)
  plan_id         uuid NOT NULL REFERENCES plans(id),              -- Plan
  status          text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','read_only','canceled')), -- trialing, active, past_due (grace), read_only (unpaid after grace), canceled
  billing_cycle   text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','yearly')), -- Billing cycle
  seats           integer NOT NULL CHECK (seats >= 1),             -- Paid users (active users cannot exceed this)
  price_per_seat  numeric(14,2) NOT NULL CHECK (price_per_seat >= 0), -- Agreed price per user per cycle, excluding VAT (custom for Enterprise)
  currency        char(3) NOT NULL DEFAULT 'AED' REFERENCES currencies(code), -- Billing currency
  payment_method  text NOT NULL DEFAULT 'card' CHECK (payment_method IN ('card','bank_transfer')), -- How invoices are paid
  card_on_file    boolean NOT NULL DEFAULT false,                  -- A card is saved at Stripe (required to start a trial)
  trial_ends_at   timestamptz,                                     -- End of the 14-day trial
  current_period_start timestamptz,                                -- Current paid period start
  current_period_end timestamptz,                                  -- Current paid period end (next renewal)
  grace_ends_at   timestamptz,                                     -- When past_due becomes read_only (payment failed + 14 days)
  cancel_at_period_end boolean NOT NULL DEFAULT false,             -- Customer cancelled; ends at period end
  canceled_at     timestamptz,                                     -- When the subscription ended
  data_delete_after date,                                          -- Tenant data deleted after this date (canceled + 90 days)
  stripe_customer_id text UNIQUE,                                  -- Stripe customer
  stripe_subscription_id text UNIQUE,                              -- Stripe subscription
  scheduled_seats integer CHECK (scheduled_seats IS NULL OR scheduled_seats >= 1), -- Fewer seats from the next renewal (migration 0005)
  scheduled_plan_id uuid REFERENCES plans(id),                     -- Downgrade from the next renewal (migration 0005)
  scheduled_billing_cycle text CHECK (scheduled_billing_cycle IN ('monthly','yearly')), -- Switch to monthly from the next renewal (migration 0005)
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  CHECK (status <> 'trialing' OR (trial_ends_at IS NOT NULL AND card_on_file)),
  CHECK (status <> 'past_due' OR grace_ends_at IS NOT NULL),
  CHECK ((status = 'canceled') = (canceled_at IS NOT NULL)),
  CHECK (status <> 'canceled' OR data_delete_after IS NOT NULL),
  CHECK (current_period_end IS NULL OR current_period_end > current_period_start)
);

--- table subscription_events | Billing | History of every subscription change: trial, plan, seats, payment failure, read-only, reactivation, cancellation. Never changed.
CREATE TABLE subscription_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Event ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Owning tenant
  subscription_id uuid NOT NULL,                                   -- Subscription
  type            text NOT NULL CHECK (type IN ('trial_started','activated','plan_changed','seats_changed','cycle_changed','payment_method_changed','payment_failed','grace_started','read_only','reactivated','cancel_requested','canceled','trial_extended','suspended','unsuspended','data_deleted')), -- What happened
  old_value       jsonb,                                           -- Before, e.g. {"seats":10}
  new_value       jsonb,                                           -- After, e.g. {"seats":12}
  actor_type      text NOT NULL CHECK (actor_type IN ('user','platform_admin','system','stripe')), -- Who caused it
  actor_user_id   uuid,                                            -- Tenant user (actor_type = user)
  platform_admin_id uuid REFERENCES platform_admins(id),           -- Platform admin (actor_type = platform_admin)
  note            text,                                            -- Note, e.g. reason for a free extension
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Time
  UNIQUE (tenant_id, id),
  CHECK ((actor_type = 'user') = (actor_user_id IS NOT NULL)),
  CHECK ((actor_type = 'platform_admin') = (platform_admin_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, subscription_id) REFERENCES subscriptions(tenant_id, id),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES users(tenant_id, id)
);

--- table billing_invoices | Billing | Our tax invoices to customers for their subscription (5% VAT), monthly or yearly.
CREATE TABLE billing_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Invoice ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Customer tenant
  subscription_id uuid NOT NULL,                                   -- Subscription
  number          text NOT NULL UNIQUE,                            -- Tax invoice number, e.g. CRM-2026-000123
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','void','uncollectible')), -- open = awaiting payment
  period_start    date NOT NULL,                                   -- Billed period start
  period_end      date NOT NULL,                                   -- Billed period end
  issue_date      date NOT NULL DEFAULT current_date,              -- Issue date
  due_date        date NOT NULL,                                   -- Payment due date
  currency        char(3) NOT NULL DEFAULT 'AED' REFERENCES currencies(code), -- Currency
  subtotal        numeric(14,2) NOT NULL CHECK (subtotal >= 0),    -- Sum of lines excluding VAT
  vat_rate        numeric(5,2) NOT NULL DEFAULT 5 CHECK (vat_rate >= 0), -- VAT %
  vat_amount      numeric(14,2) NOT NULL CHECK (vat_amount >= 0),  -- VAT amount
  total           numeric(14,2) GENERATED ALWAYS AS (subtotal + vat_amount) STORED, -- Total including VAT
  amount_paid     numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0), -- Paid so far
  balance         numeric(14,2) GENERATED ALWAYS AS (subtotal + vat_amount - amount_paid) STORED, -- Amount still due
  customer_legal_name text NOT NULL,                               -- Customer name as on the invoice
  customer_trn    text,                                            -- Customer VAT number (TRN), if registered
  customer_address text,                                           -- Customer address
  pdf_file_id     uuid,                                            -- Generated PDF (files)
  stripe_invoice_id text UNIQUE,                                   -- Stripe invoice
  paid_at         timestamptz,                                     -- When fully paid
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  CHECK (period_end >= period_start),
  CHECK (due_date >= issue_date),
  CHECK (status <> 'paid' OR (amount_paid >= subtotal + vat_amount AND paid_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, subscription_id) REFERENCES subscriptions(tenant_id, id),
  FOREIGN KEY (tenant_id, pdf_file_id) REFERENCES files(tenant_id, id)
);

--- table billing_invoice_lines | Billing | Lines of a subscription invoice: seats x price, extra seats added mid-period (pro-rata), credits.
CREATE TABLE billing_invoice_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Line ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Customer tenant
  invoice_id      uuid NOT NULL,                                   -- Invoice
  line_no         smallint NOT NULL CHECK (line_no > 0),           -- Line order
  type            text NOT NULL CHECK (type IN ('subscription','extra_seats','credit')), -- Line type
  description     text NOT NULL,                                   -- e.g. Team plan, 10 users, Nov 2026
  quantity        integer NOT NULL CHECK (quantity > 0),           -- Seats
  unit_price      numeric(14,2) NOT NULL,                          -- Price per seat (negative for credits)
  amount          numeric(14,2) NOT NULL,                          -- Line amount excluding VAT
  UNIQUE (tenant_id, invoice_id, line_no),
  CHECK ((type = 'credit') = (amount < 0)),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES billing_invoices(tenant_id, id) ON DELETE CASCADE
);

--- table billing_payments | Billing | Card payments (from Stripe) and bank transfers (confirmed by the platform team) against subscription invoices.
CREATE TABLE billing_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Payment ID
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Customer tenant
  invoice_id      uuid NOT NULL,                                   -- Invoice paid
  method          text NOT NULL CHECK (method IN ('card','bank_transfer')), -- Payment method
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded')), -- Payment status
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),       -- Amount
  currency        char(3) NOT NULL DEFAULT 'AED' REFERENCES currencies(code), -- Currency
  stripe_payment_intent_id text UNIQUE,                            -- Stripe payment (card)
  bank_reference  text,                                            -- Bank transfer reference
  proof_file_id   uuid,                                            -- Transfer receipt uploaded by the customer (files)
  confirmed_by    uuid REFERENCES platform_admins(id),             -- Platform admin who confirmed a bank transfer
  failure_reason  text,                                            -- Why a card payment failed
  received_at     timestamptz,                                     -- When the money was received
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Created time
  updated_at      timestamptz NOT NULL DEFAULT now(),              -- Last update time
  UNIQUE (tenant_id, id),
  CHECK (method <> 'card' OR stripe_payment_intent_id IS NOT NULL),
  CHECK (method <> 'bank_transfer' OR status <> 'succeeded' OR confirmed_by IS NOT NULL),
  CHECK (status <> 'succeeded' OR received_at IS NOT NULL),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES billing_invoices(tenant_id, id),
  FOREIGN KEY (tenant_id, proof_file_id) REFERENCES files(tenant_id, id)
);

--- table signups | Billing | Sign-ups in progress: email code, Stripe card setup, before the company exists (migration 0005).
CREATE TABLE signups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- Sign-up ID
  tenant_type     text NOT NULL CHECK (tenant_type IN ('brokerage','individual')), -- Brokerage (B2B) or individual agent (B2C)
  company_name    text NOT NULL,                                   -- Company or agent name
  trade_license_no text,                                           -- Trade licence (brokerage)
  rera_orn        text,                                            -- RERA office number (brokerage)
  rera_brn        text,                                            -- RERA broker card (individual)
  admin_full_name text NOT NULL,                                   -- First Admin
  admin_email     citext NOT NULL,                                 -- First Admin's login email
  admin_phone     text NOT NULL CHECK (admin_phone ~ '^\+[1-9][0-9]{6,14}$'), -- First Admin's phone
  plan_id         uuid NOT NULL REFERENCES plans(id),              -- Chosen plan
  seats           integer NOT NULL CHECK (seats >= 1),             -- Paid users
  billing_cycle   text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')), -- Billing cycle
  code_hash       text NOT NULL,                                   -- SHA-256 of the emailed 6-digit code
  code_expires_at timestamptz NOT NULL,                            -- Code valid until (15 minutes)
  code_attempts   smallint NOT NULL DEFAULT 0,                     -- Wrong tries (max 5)
  code_sent_at    timestamptz NOT NULL DEFAULT now(),              -- Last code email (resend at most once a minute)
  email_verified_at timestamptz,                                   -- Email confirmed
  stripe_customer_id text,                                         -- Stripe customer
  stripe_setup_intent_id text,                                     -- Stripe card setup
  tenant_id       uuid REFERENCES tenants(id),                     -- Company created on completion
  ip_address      inet,                                            -- Where the sign-up came from
  expires_at      timestamptz NOT NULL,                            -- Sign-up abandoned after this time
  completed_at    timestamptz,                                     -- Completed time
  created_at      timestamptz NOT NULL DEFAULT now(),              -- Started time
  CHECK (tenant_type <> 'brokerage' OR (trade_license_no IS NOT NULL AND rera_orn IS NOT NULL)),
  CHECK (tenant_type <> 'individual' OR rera_brn IS NOT NULL),
  CHECK ((completed_at IS NULL) = (tenant_id IS NULL))
);

--- table tenant_usage_daily | Billing | Daily usage per tenant for the owner console: active users, leads, messages, storage.
CREATE TABLE tenant_usage_daily (
  tenant_id       uuid NOT NULL REFERENCES tenants(id),            -- Tenant
  day             date NOT NULL,                                   -- Day (UAE time)
  active_users    integer NOT NULL DEFAULT 0 CHECK (active_users >= 0), -- Active users
  leads_created   integer NOT NULL DEFAULT 0 CHECK (leads_created >= 0), -- New leads that day
  messages_sent   integer NOT NULL DEFAULT 0 CHECK (messages_sent >= 0), -- WhatsApp and email sent
  storage_bytes   bigint NOT NULL DEFAULT 0 CHECK (storage_bytes >= 0), -- Files stored
  PRIMARY KEY (tenant_id, day)
);

--- table platform_audit_logs | Platform | Every owner-console action (view tenant, suspend, extend trial, confirm transfer, change plans). Never changed.
CREATE TABLE platform_audit_logs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- Audit ID (ordered)
  platform_admin_id uuid REFERENCES platform_admins(id),           -- Acting platform admin (empty = system)
  action          text NOT NULL,                                   -- e.g. tenant.suspend, payment.confirm, plan.update
  tenant_id       uuid REFERENCES tenants(id),                     -- Tenant affected (if any)
  entity_type     text,                                            -- Entity, e.g. subscriptions
  entity_id       uuid,                                            -- Row ID
  changes         jsonb,                                           -- Changed fields
  ip_address      inet,                                            -- Client IP
  created_at      timestamptz NOT NULL DEFAULT now()               -- Time
);

-- ============================== INDEXES =============================
CREATE INDEX users_role_idx ON users (tenant_id, role_id);
CREATE INDEX users_team_idx ON users (tenant_id, team_id);
CREATE INDEX teams_manager_idx ON teams (tenant_id, sales_manager_user_id);
CREATE INDEX teams_division_idx ON teams (tenant_id, division_id);

CREATE INDEX leads_owner_idx      ON leads (tenant_id, owner_user_id, next_follow_up_at) WHERE deleted_at IS NULL;
CREATE INDEX leads_team_idx       ON leads (tenant_id, team_id) WHERE deleted_at IS NULL;
CREATE INDEX leads_stage_idx      ON leads (tenant_id, stage_id) WHERE deleted_at IS NULL;
CREATE INDEX leads_next_appointment_idx ON leads (tenant_id, next_appointment_at) WHERE next_appointment_at IS NOT NULL;
CREATE INDEX leads_followup_idx   ON leads (tenant_id, next_follow_up_at) WHERE deleted_at IS NULL AND stage_category = 'open';
CREATE INDEX leads_score_idx      ON leads (tenant_id, score DESC, next_follow_up_at) WHERE deleted_at IS NULL;
CREATE INDEX leads_created_idx    ON leads (tenant_id, created_at DESC);
CREATE INDEX leads_unassigned_idx ON leads (tenant_id, created_at) WHERE owner_user_id IS NULL AND stage_category = 'open' AND deleted_at IS NULL;
CREATE INDEX leads_phone_idx      ON leads (tenant_id, phone_primary) WHERE deleted_at IS NULL;
CREATE INDEX leads_phone_alt_idx  ON leads (tenant_id, phone_alternate) WHERE deleted_at IS NULL AND phone_alternate IS NOT NULL;
CREATE INDEX leads_email_idx      ON leads (tenant_id, email) WHERE deleted_at IS NULL;
CREATE INDEX leads_name_trgm_idx  ON leads USING gin (full_name gin_trgm_ops);
CREATE INDEX leads_source_idx     ON leads (tenant_id, source_id, created_at);
CREATE INDEX leads_campaign_idx   ON leads (tenant_id, campaign_id, created_at);
CREATE INDEX leads_event_idx      ON leads (tenant_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX leads_response_due_idx ON leads (response_due_at) WHERE response_due_at IS NOT NULL;
CREATE INDEX leads_re_enquiry_idx ON leads (tenant_id, last_enquiry_at DESC) WHERE enquiry_count > 1;

CREATE INDEX lead_inquiries_lead_idx ON lead_inquiries (tenant_id, lead_id, submitted_at DESC);
CREATE INDEX lead_inquiries_campaign_idx ON lead_inquiries (tenant_id, campaign_id, submitted_at);
CREATE INDEX lead_projects_project_idx ON lead_projects (tenant_id, project_id);
CREATE UNIQUE INDEX lead_substatuses_name_uq ON lead_substatuses (tenant_id, stage_id, lower(name));
CREATE INDEX lead_substatuses_stage_idx ON lead_substatuses (tenant_id, stage_id, sort_order);
CREATE INDEX lead_stage_history_lead_idx ON lead_stage_history (tenant_id, lead_id, changed_at);
CREATE INDEX lead_stage_history_to_idx ON lead_stage_history (tenant_id, to_stage_id, changed_at);
CREATE INDEX lead_assignments_lead_idx ON lead_assignments (tenant_id, lead_id, changed_at);
CREATE INDEX lead_shares_user_idx ON lead_shares (tenant_id, user_id);
CREATE INDEX activities_lead_idx ON activities (tenant_id, lead_id, occurred_at DESC);
CREATE INDEX attachments_lead_idx ON attachments (tenant_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX attachments_project_idx ON attachments (tenant_id, project_id) WHERE project_id IS NOT NULL;
CREATE INDEX attachments_unit_idx ON attachments (tenant_id, unit_id) WHERE unit_id IS NOT NULL;
CREATE INDEX attachments_doc_idx ON attachments (tenant_id, finance_document_id) WHERE finance_document_id IS NOT NULL;

CREATE INDEX tasks_user_due_idx ON tasks (tenant_id, assigned_user_id, due_at) WHERE status = 'open';
CREATE INDEX tasks_lead_idx ON tasks (tenant_id, lead_id, due_at);
CREATE INDEX tasks_reminder_idx ON tasks (due_at) WHERE status = 'open' AND reminded_at IS NULL;
CREATE INDEX meetings_user_time_idx ON meetings (tenant_id, organizer_user_id, starts_at);
CREATE INDEX meetings_lead_idx ON meetings (tenant_id, lead_id, starts_at);

CREATE INDEX conversations_lead_idx ON conversations (tenant_id, lead_id);
CREATE INDEX messages_conversation_idx ON messages (tenant_id, conversation_id, created_at);
CREATE INDEX messages_lead_idx ON messages (tenant_id, lead_id, created_at);
CREATE INDEX messages_campaign_idx ON messages (tenant_id, campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX consents_latest_idx ON consents (tenant_id, lead_id, channel, recorded_at DESC);

CREATE INDEX units_project_status_idx ON units (tenant_id, project_id, status);
CREATE INDEX units_search_idx ON units (tenant_id, property_type, bedrooms, price);
CREATE INDEX unit_changes_unit_idx ON unit_changes (tenant_id, unit_id, changed_at);
CREATE INDEX deals_lead_idx ON deals (tenant_id, lead_id);
CREATE INDEX deals_project_idx ON deals (tenant_id, project_id, stage);

CREATE INDEX finance_documents_status_idx ON finance_documents (tenant_id, doc_type, status, due_date);
CREATE INDEX finance_documents_lead_idx ON finance_documents (tenant_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX finance_documents_deal_idx ON finance_documents (tenant_id, deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX finance_document_lines_doc_idx ON finance_document_lines (tenant_id, document_id);
CREATE INDEX payments_document_idx ON payments (tenant_id, document_id);
CREATE INDEX finance_document_events_doc_idx ON finance_document_events (tenant_id, document_id, created_at);
CREATE INDEX commissions_user_idx ON commissions (tenant_id, user_id, status);

CREATE INDEX attendance_records_date_idx ON attendance_records (tenant_id, work_date);
CREATE INDEX attendance_corrections_pending_idx ON attendance_corrections (tenant_id, created_at) WHERE status = 'pending';
CREATE INDEX leave_requests_user_idx ON leave_requests (tenant_id, user_id, start_date);

CREATE INDEX lead_imports_created_idx ON lead_imports (tenant_id, created_at DESC);
CREATE INDEX signups_email_idx ON signups (admin_email) WHERE completed_at IS NULL;
CREATE SEQUENCE billing_invoice_number_seq; -- Tax invoice numbers CRM-YYYY-NNNNNN (migration 0005)
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);
CREATE INDEX notifications_user_idx ON notifications (tenant_id, user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX webhook_events_status_idx ON webhook_events (status, received_at) WHERE status IN ('received','failed');
CREATE INDEX integration_sync_runs_idx ON integration_sync_runs (tenant_id, integration_id, started_at DESC);
CREATE INDEX export_logs_idx ON export_logs (tenant_id, created_at DESC);
CREATE INDEX export_logs_report_idx ON export_logs (tenant_id, report_key, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (tenant_id, entity_type, entity_id, created_at);
CREATE INDEX audit_logs_time_idx ON audit_logs (tenant_id, created_at);

CREATE INDEX subscriptions_status_idx ON subscriptions (status, trial_ends_at, grace_ends_at);
CREATE INDEX subscriptions_renewal_idx ON subscriptions (current_period_end) WHERE status IN ('active','past_due');
CREATE INDEX subscriptions_deletion_idx ON subscriptions (data_delete_after) WHERE status = 'canceled';
CREATE INDEX subscription_events_sub_idx ON subscription_events (tenant_id, subscription_id, created_at);
CREATE INDEX billing_invoices_tenant_idx ON billing_invoices (tenant_id, issue_date DESC);
CREATE INDEX billing_invoices_open_idx ON billing_invoices (due_date) WHERE status = 'open';
CREATE INDEX billing_payments_invoice_idx ON billing_payments (tenant_id, invoice_id);
CREATE INDEX billing_payments_pending_idx ON billing_payments (created_at) WHERE status = 'pending' AND method = 'bank_transfer';
CREATE INDEX sales_enquiries_status_idx ON sales_enquiries (status, created_at DESC);
CREATE INDEX platform_audit_logs_tenant_idx ON platform_audit_logs (tenant_id, created_at);

-- ============================ VIEWS =================================
--- view lead_consent_current | Latest consent status per lead and channel (used to block opted-out contacts).
CREATE VIEW lead_consent_current WITH (security_invoker = true) AS
SELECT DISTINCT ON (tenant_id, lead_id, channel)
       tenant_id, lead_id, channel, status, recorded_at
FROM consents
ORDER BY tenant_id, lead_id, channel, recorded_at DESC, id DESC;
