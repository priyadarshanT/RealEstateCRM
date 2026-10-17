import { boolean, char, date, jsonb, numeric, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Projects and inventory (db/schema.sql, PROJECTS AND INVENTORY): developers, projects, buildings, units and the
// history of every unit price and status change.

export const CONSTRUCTION_STATUSES = ['off_plan', 'under_construction', 'ready'] as const;
/** Project page tabs (migration 0010). */
export const PROJECT_CATEGORIES = ['residential', 'commercial', 'agricultural'] as const;
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];
export const PROPERTY_TYPES = ['apartment', 'villa', 'townhouse', 'penthouse', 'duplex', 'office', 'retail', 'plot'] as const;
export const UNIT_STATUSES = ['available', 'on_hold', 'booked', 'sold'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const developers = pgTable('developers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  trn: text('trn'),
  contactName: text('contact_name'),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  website: text('website'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  developerId: uuid('developer_id').notNull(),
  name: text('name').notNull(),
  community: text('community'),
  city: text('city').notNull().default('Dubai'),
  address: text('address'),
  latitude: numeric('latitude', { precision: 9, scale: 6 }),
  longitude: numeric('longitude', { precision: 9, scale: 6 }),
  description: text('description'),
  constructionStatus: text('construction_status').$type<(typeof CONSTRUCTION_STATUSES)[number]>().notNull().default('off_plan'),
  handoverDate: date('handover_date'),
  paymentPlan: text('payment_plan'),
  brochureFileId: uuid('brochure_file_id'),
  isActive: boolean('is_active').notNull().default(true),
  category: text('category').$type<ProjectCategory>().notNull().default('residential'),
  assignedUserId: uuid('assigned_user_id'),
  customValues: jsonb('custom_values').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const buildings = pgTable('buildings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  floors: smallint('floors'),
  handoverDate: date('handover_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const units = pgTable('units', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  projectId: uuid('project_id').notNull(),
  buildingId: uuid('building_id'),
  unitNumber: text('unit_number').notNull(),
  propertyType: text('property_type').$type<(typeof PROPERTY_TYPES)[number]>().notNull(),
  bedrooms: smallint('bedrooms').notNull(),
  bathrooms: smallint('bathrooms'),
  sizeSqft: numeric('size_sqft', { precision: 10, scale: 2 }).notNull(),
  floor: smallint('floor'),
  view: text('view'),
  price: numeric('price', { precision: 14, scale: 2 }).notNull(),
  currency: char('currency', { length: 3 }).notNull().default('AED'),
  paymentPlan: text('payment_plan'),
  handoverDate: date('handover_date'),
  status: text('status').$type<UnitStatus>().notNull().default('available'),
  holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
  floorPlanFileId: uuid('floor_plan_file_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const unitChanges = pgTable('unit_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  oldStatus: text('old_status'),
  newStatus: text('new_status'),
  oldPrice: numeric('old_price', { precision: 14, scale: 2 }),
  newPrice: numeric('new_price', { precision: 14, scale: 2 }),
  reason: text('reason'),
  changedBy: uuid('changed_by'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});

export type DeveloperRow = typeof developers.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type BuildingRow = typeof buildings.$inferSelect;
export type UnitRow = typeof units.$inferSelect;
export type UnitChangeRow = typeof unitChanges.$inferSelect;
