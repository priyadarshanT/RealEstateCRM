import { boolean, char, date, jsonb, numeric, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Tables owned by the settings module (definitions in db/schema.sql). Other modules use SettingsService.

export const tenantSettings = pgTable('tenant_settings', {
  tenantId: uuid('tenant_id').notNull(),
  key: text('key').notNull(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const currencies = pgTable('currencies', {
  code: char('code', { length: 3 }).primaryKey(),
  name: text('name').notNull(),
});

export const tenantCurrencies = pgTable('tenant_currencies', {
  tenantId: uuid('tenant_id').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
});

export const exchangeRates = pgTable('exchange_rates', {
  tenantId: uuid('tenant_id').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  effectiveDate: date('effective_date').notNull(),
  rateToBase: numeric('rate_to_base', { precision: 18, scale: 8 }).notNull(),
});

export const leadStages = pgTable('lead_stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  category: text('category').$type<'open' | 'won' | 'lost' | 'invalid'>().notNull(),
  sortOrder: smallint('sort_order').notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  color: text('color').notNull(),
  description: text('description'),
  requiresScheduling: boolean('requires_scheduling').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

/** Substatuses under the four fixed statuses (migration 0006); only the Admin manages them. */
export const leadSubstatuses = pgTable('lead_substatuses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  stageId: uuid('stage_id').notNull(),
  name: text('name').notNull(),
  sortOrder: smallint('sort_order').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  requiresScheduling: boolean('requires_scheduling').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const reasons = pgTable('reasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  type: text('type').$type<'lost' | 'invalid' | 'reassignment'>().notNull(),
  key: text('key'),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const LEAD_SOURCE_TYPES = [
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
  'whatsapp',
  'import',
  'manual',
  'event',
  'referral',
  'other',
] as const;
export type LeadSourceType = (typeof LEAD_SOURCE_TYPES)[number];

export const leadSources = pgTable('lead_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  type: text('type').$type<LeadSourceType>().notNull(),
  name: text('name').notNull(),
  integrationId: uuid('integration_id'),
  qualityScore: smallint('quality_score').notNull().default(50),
  isActive: boolean('is_active').notNull().default(true),
});

export type LeadStageRow = typeof leadStages.$inferSelect;
export type LeadSubstatusRow = typeof leadSubstatuses.$inferSelect;
export type ReasonRow = typeof reasons.$inferSelect;
export type LeadSourceRow = typeof leadSources.$inferSelect;
export type SettingRow = typeof tenantSettings.$inferSelect;
