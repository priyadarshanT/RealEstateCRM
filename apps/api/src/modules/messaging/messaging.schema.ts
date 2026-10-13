import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Messaging tables (db/schema.sql, MESSAGING): templates, one-to-one conversations and messages,
// bulk campaigns with their recipients, and consent history.

export type Channel = 'whatsapp' | 'email';
export type TemplateStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'disabled';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';

export const messageTemplates = pgTable('message_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  channel: text('channel').$type<Channel>().notNull(),
  name: text('name').notNull(),
  language: text('language').notNull().default('en'),
  category: text('category').$type<'marketing' | 'utility' | 'authentication' | 'transactional'>().notNull(),
  subject: text('subject'),
  body: text('body').notNull(),
  variables: jsonb('variables').$type<{ name: string; example?: string }[]>().notNull().default([]),
  integrationId: uuid('integration_id'),
  providerTemplateId: text('provider_template_id'),
  status: text('status').$type<TemplateStatus>().notNull().default('draft'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  channel: text('channel').$type<Channel>().notNull(),
  integrationId: uuid('integration_id').notNull(),
  contactAddress: text('contact_address').notNull(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  unreadCount: integer('unread_count').notNull().default(0),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  conversationId: uuid('conversation_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  direction: text('direction').$type<'inbound' | 'outbound'>().notNull(),
  templateId: uuid('template_id'),
  campaignId: uuid('campaign_id'),
  subject: text('subject'),
  body: text('body'),
  mediaFileId: uuid('media_file_id'),
  providerMessageId: text('provider_message_id'),
  status: text('status').$type<MessageStatus>().notNull(),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  sentBy: uuid('sent_by'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messageCampaigns = pgTable('message_campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  channel: text('channel').$type<Channel>().notNull(),
  templateId: uuid('template_id').notNull(),
  integrationId: uuid('integration_id').notNull(),
  audienceFilter: jsonb('audience_filter').$type<Record<string, unknown>>().notNull(),
  audienceCount: integer('audience_count'),
  status: text('status').$type<'draft' | 'pending_approval' | 'approved' | 'rejected' | 'sending' | 'completed' | 'cancelled'>().notNull().default('draft'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  testSentAt: timestamp('test_sent_at', { withTimezone: true }),
  testRecipient: text('test_recipient'),
  createdBy: uuid('created_by').notNull(),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  rejectionNote: text('rejection_note'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messageCampaignRecipients = pgTable(
  'message_campaign_recipients',
  {
    tenantId: uuid('tenant_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    leadId: uuid('lead_id').notNull(),
    address: text('address').notNull(),
    status: text('status').$type<'pending' | 'skipped_opted_out' | 'sent' | 'delivered' | 'failed' | 'replied' | 'opted_out'>().notNull().default('pending'),
    messageId: uuid('message_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.leadId] })],
);

export const consents = pgTable('consents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  channel: text('channel').$type<'whatsapp' | 'email' | 'sms'>().notNull(),
  status: text('status').$type<'opted_in' | 'opted_out'>().notNull(),
  captureMethod: text('capture_method').$type<'form' | 'import' | 'reply' | 'unsubscribe_link' | 'manual' | 'provider'>().notNull(),
  note: text('note'),
  recordedBy: uuid('recorded_by'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TemplateRow = typeof messageTemplates.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type CampaignRow = typeof messageCampaigns.$inferSelect;
export type ConsentRow = typeof consents.$inferSelect;
