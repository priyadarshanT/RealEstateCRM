import { boolean, char, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Tables owned by the leads module (definitions in db/schema.sql). Other modules use LeadsService or domain events.

export type StageCategory = 'open' | 'won' | 'lost' | 'invalid';
export type Priority = 'low' | 'medium' | 'high';

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  fullName: text('full_name').notNull(),
  phonePrimary: text('phone_primary'),
  phoneAlternate: text('phone_alternate'),
  email: text('email'),
  countryCode: char('country_code', { length: 2 }),
  preferredLanguage: text('preferred_language'),
  budgetMin: numeric('budget_min', { precision: 14, scale: 2 }),
  budgetMax: numeric('budget_max', { precision: 14, scale: 2 }),
  budgetCurrency: char('budget_currency', { length: 3 }),
  sourceId: uuid('source_id').notNull(),
  campaignId: uuid('campaign_id'),
  eventId: uuid('event_id'),
  formName: text('form_name'),
  ownerUserId: uuid('owner_user_id'),
  teamId: uuid('team_id'),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),
  responseDueAt: timestamp('response_due_at', { withTimezone: true }),
  firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
  stageId: uuid('stage_id').notNull(),
  stageCategory: text('stage_category').$type<StageCategory>().notNull(),
  substatusId: uuid('substatus_id'),
  closeReasonId: uuid('close_reason_id'),
  closeNote: text('close_note'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  priority: text('priority').$type<Priority>().notNull().default('medium'),
  score: smallint('score').notNull().default(0),
  latestNote: text('latest_note'),
  nextFollowUpAt: timestamp('next_follow_up_at', { withTimezone: true }),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  enquiryCount: integer('enquiry_count').notNull().default(1),
  lastEnquiryAt: timestamp('last_enquiry_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const leadInquiries = pgTable('lead_inquiries', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  sourceId: uuid('source_id').notNull(),
  campaignId: uuid('campaign_id'),
  eventId: uuid('event_id'),
  integrationId: uuid('integration_id'),
  projectId: uuid('project_id'),
  externalCampaignId: text('external_campaign_id'),
  externalAdsetId: text('external_adset_id'),
  externalAdId: text('external_ad_id'),
  externalFormId: text('external_form_id'),
  externalSubmissionId: text('external_submission_id'),
  isReEnquiry: boolean('is_re_enquiry').notNull().default(false),
  formName: text('form_name'),
  formAnswers: jsonb('form_answers').$type<Record<string, unknown>>().notNull().default({}),
  rawPayload: jsonb('raw_payload'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leadProjects = pgTable('lead_projects', {
  tenantId: uuid('tenant_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  projectId: uuid('project_id').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leadStageHistory = pgTable('lead_stage_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  fromStageId: uuid('from_stage_id'),
  toStageId: uuid('to_stage_id').notNull(),
  toSubstatusId: uuid('to_substatus_id'),
  reasonId: uuid('reason_id'),
  note: text('note'),
  isAutomatic: boolean('is_automatic').notNull().default(false),
  changedBy: uuid('changed_by'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AssignmentMethod = 'manual' | 'round_robin' | 'rule' | 'no_response' | 'admin_fallback' | 'user_deactivated' | 're_enquiry';

export const leadAssignments = pgTable('lead_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  fromUserId: uuid('from_user_id'),
  toUserId: uuid('to_user_id'),
  method: text('method').$type<AssignmentMethod>().notNull(),
  ruleId: uuid('rule_id'),
  reasonId: uuid('reason_id'),
  note: text('note'),
  changedBy: uuid('changed_by'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leadShares = pgTable('lead_shares', {
  tenantId: uuid('tenant_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  userId: uuid('user_id').notNull(),
  access: text('access').$type<'view' | 'edit'>().notNull(),
  sharedBy: uuid('shared_by').notNull(),
  sharedAt: timestamp('shared_at', { withTimezone: true }).notNull().defaultNow(),
});

export const SAVED_FILTER_ENTITIES = ['leads', 'tasks', 'units', 'finance_documents', 'messages', 'attendance'] as const;

export const savedFilters = pgTable('saved_filters', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  entity: text('entity').$type<(typeof SAVED_FILTER_ENTITIES)[number]>().notNull(),
  name: text('name').notNull(),
  filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
  columns: jsonb('columns').$type<string[]>().notNull().default([]),
  sort: jsonb('sort').$type<string[]>().notNull().default([]),
  sharedTeamId: uuid('shared_team_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ACTIVITY_TYPES = [
  'inquiry',
  're_enquiry',
  'note',
  'call',
  'stage_change',
  'owner_change',
  'share',
  'whatsapp',
  'email',
  'meeting',
  'viewing',
  'attachment',
  'deal',
  'eoi',
  'booking',
  'invoice',
  'purchase_order',
  'payment',
  'system',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const activities = pgTable('activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  type: text('type').$type<ActivityType>().notNull(),
  summary: text('summary').notNull(),
  body: text('body'),
  actorUserId: uuid('actor_user_id'),
  inquiryId: uuid('inquiry_id'),
  taskId: uuid('task_id'),
  meetingId: uuid('meeting_id'),
  messageId: uuid('message_id'),
  fileId: uuid('file_id'),
  dealId: uuid('deal_id'),
  financeDocumentId: uuid('finance_document_id'),
  paymentId: uuid('payment_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

export type LeadRow = typeof leads.$inferSelect;
export type InquiryRow = typeof leadInquiries.$inferSelect;
export type ActivityRow = typeof activities.$inferSelect;
export type SavedFilterRow = typeof savedFilters.$inferSelect;
