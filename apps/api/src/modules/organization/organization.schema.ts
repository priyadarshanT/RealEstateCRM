import { boolean, char, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Tables owned by the organization module (definitions in db/schema.sql). Other modules use OrganizationService.
// updated_at is read as text so it can be used as an exact ETag (microsecond precision).

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  type: text('type').$type<'brokerage' | 'individual'>().notNull(),
  name: text('name').notNull(),
  legalName: text('legal_name'),
  tradeLicenseNo: text('trade_license_no'),
  reraOrn: text('rera_orn'),
  reraBrn: text('rera_brn'),
  trn: text('trn'),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  website: text('website'),
  logoFileId: uuid('logo_file_id'),
  tradeLicenseFileId: uuid('trade_license_file_id'),
  timezone: text('timezone').notNull(),
  baseCurrency: char('base_currency', { length: 3 }).notNull(),
  verificationStatus: text('verification_status').$type<'pending' | 'verified' | 'rejected'>().notNull(),
  status: text('status').$type<'active' | 'suspended' | 'closed'>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  module: text('module').notNull(),
  description: text('description').notNull(),
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  dataScope: text('data_scope').$type<'own' | 'team' | 'division' | 'company'>().notNull(),
  isSystem: boolean('is_system').notNull().default(false),
});

export const rolePermissions = pgTable('role_permissions', {
  tenantId: uuid('tenant_id').notNull(),
  roleId: uuid('role_id').notNull(),
  permissionKey: text('permission_key').notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  authSubject: text('auth_subject'),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  roleId: uuid('role_id').notNull(),
  teamId: uuid('team_id'),
  status: text('status').$type<'invited' | 'active' | 'inactive'>().notNull().default('invited'),
  receivesLeads: boolean('receives_leads').notNull().default(true),
  languages: text('languages').array().notNull().default([]),
  location: text('location'),
  timezone: text('timezone').notNull().default('Asia/Dubai'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const divisions = pgTable('divisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  gmUserId: uuid('gm_user_id'),
  isActive: boolean('is_active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  divisionId: uuid('division_id'),
  name: text('name').notNull(),
  salesManagerUserId: uuid('sales_manager_user_id'),
  teamLeaderUserId: uuid('team_leader_user_id'),
  isActive: boolean('is_active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export type TenantRow = typeof tenants.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;
export type TeamRow = typeof teams.$inferSelect;
export type DivisionRow = typeof divisions.$inferSelect;
