import { char, date, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// deals (db/schema.sql, DEALS): a lead's purchase of one unit: offer, EOI, booking and sale.

export const DEAL_STAGES = ['offer', 'eoi', 'booking', 'sold', 'cancelled'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const deals = pgTable('deals', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  projectId: uuid('project_id').notNull(),
  unitId: uuid('unit_id'),
  ownerUserId: uuid('owner_user_id').notNull(),
  stage: text('stage').$type<DealStage>().notNull().default('offer'),
  currency: char('currency', { length: 3 }).notNull().default('AED'),
  offerPrice: numeric('offer_price', { precision: 14, scale: 2 }),
  offerDate: date('offer_date'),
  eoiAmount: numeric('eoi_amount', { precision: 14, scale: 2 }),
  eoiDate: date('eoi_date'),
  bookingAmount: numeric('booking_amount', { precision: 14, scale: 2 }),
  bookingDate: date('booking_date'),
  saleValue: numeric('sale_value', { precision: 14, scale: 2 }),
  saleDate: date('sale_date'),
  cancelledReason: text('cancelled_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type DealRow = typeof deals.$inferSelect;
