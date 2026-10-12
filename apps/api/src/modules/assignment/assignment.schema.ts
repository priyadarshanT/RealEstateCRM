import { boolean, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Tables owned by the assignment module (db/schema.sql).

export interface RuleConditions {
  project_ids?: string[];
  campaign_ids?: string[];
  source_ids?: string[];
  languages?: string[];
  locations?: string[];
}

export const assignmentRules = pgTable('assignment_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  priority: smallint('priority').notNull(),
  conditions: jsonb('conditions').$type<RuleConditions>().notNull().default({}),
  targetTeamId: uuid('target_team_id'),
  respectAvailability: boolean('respect_availability').notNull().default(true),
  lastAssignedUserId: uuid('last_assigned_user_id'),
  isActive: boolean('is_active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const assignmentRuleMembers = pgTable('assignment_rule_members', {
  tenantId: uuid('tenant_id').notNull(),
  ruleId: uuid('rule_id').notNull(),
  userId: uuid('user_id').notNull(),
});

export type RuleRow = typeof assignmentRules.$inferSelect;
