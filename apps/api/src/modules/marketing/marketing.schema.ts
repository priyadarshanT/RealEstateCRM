import { char, date, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Ad campaigns and daily ad spend (db/schema.sql, Marketing).
export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  sourceId: uuid('source_id').notNull(),
  externalId: text('external_id'),
  name: text('name').notNull(),
  status: text('status').$type<'active' | 'paused' | 'ended'>().notNull().default('active'),
  startsOn: date('starts_on'),
  endsOn: date('ends_on'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const adSpendDaily = pgTable('ad_spend_daily', {
  tenantId: uuid('tenant_id').notNull(),
  campaignId: uuid('campaign_id').notNull(),
  spendDate: date('spend_date').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  entryMethod: text('entry_method').$type<'api' | 'manual'>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CampaignRow = typeof campaigns.$inferSelect;
