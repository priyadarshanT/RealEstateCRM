import { integer, jsonb, pgTable, smallint, text, timestamp, uuid, boolean } from 'drizzle-orm/pg-core';

// Tables owned by the integrations module (db/schema.sql).

export const PROVIDERS = [
  'meta',
  'google_ads',
  'linkedin',
  'snapchat',
  'tiktok',
  'website',
  'webhook',
  'property_finder',
  'bayut',
  'dubizzle',
  'whatsapp_cloud',
  'email_ses',
  'gmail',
  'microsoft_365',
  'google_workspace',
] as const;
export type Provider = (typeof PROVIDERS)[number];

export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  provider: text('provider').$type<Provider>().notNull(),
  scope: text('scope').$type<'tenant' | 'user'>().notNull().default('tenant'),
  userId: uuid('user_id'),
  accountLabel: text('account_label').notNull(),
  externalAccountId: text('external_account_id'),
  status: text('status').$type<'pending' | 'connected' | 'error' | 'disconnected'>().notNull().default('pending'),
  secretRef: text('secret_ref'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
  lastError: text('last_error'),
  connectedBy: uuid('connected_by'),
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'),
  integrationId: uuid('integration_id'),
  provider: text('provider').notNull(),
  externalEventId: text('external_event_id').notNull(),
  signatureValid: boolean('signature_valid').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: text('status').$type<'received' | 'processed' | 'failed' | 'ignored'>().notNull().default('received'),
  attempts: smallint('attempts').notNull().default(0),
  lastError: text('last_error'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

export const syncRuns = pgTable('integration_sync_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  integrationId: uuid('integration_id').notNull(),
  jobType: text('job_type').notNull(),
  status: text('status').$type<'running' | 'success' | 'partial' | 'failed'>().notNull(),
  recordsReceived: integer('records_received').notNull().default(0),
  recordsCreated: integer('records_created').notNull().default(0),
  recordsFailed: integer('records_failed').notNull().default(0),
  errorDetail: text('error_detail'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export type IntegrationRow = typeof integrations.$inferSelect;
export type WebhookEventRow = typeof webhookEvents.$inferSelect;
