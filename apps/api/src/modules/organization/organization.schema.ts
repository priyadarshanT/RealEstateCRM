import { boolean, char, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Tables owned by the organization module (definitions in db/schema.sql). Other modules use OrganizationService.

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
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  dataScope: text('data_scope').$type<'own' | 'team' | 'division' | 'company'>().notNull(),
  isSystem: boolean('is_system').notNull(),
});

export const rolePermissions = pgTable('role_permissions', {
  tenantId: uuid('tenant_id').notNull(),
  roleId: uuid('role_id').notNull(),
  permissionKey: text('permission_key').notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  authSubject: text('auth_subject'),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  roleId: uuid('role_id').notNull(),
  teamId: uuid('team_id'),
  status: text('status').$type<'invited' | 'active' | 'inactive'>().notNull(),
  receivesLeads: boolean('receives_leads').notNull(),
  languages: text('languages').array().notNull(),
  location: text('location'),
  timezone: text('timezone').notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});

export type TenantRow = typeof tenants.$inferSelect;
export type UserRow = typeof users.$inferSelect;
