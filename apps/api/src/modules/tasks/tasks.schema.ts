import { pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// tasks (db/schema.sql), owned by the tasks module.
export const TASK_TYPES = ['call', 'follow_up', 'meeting', 'viewing', 'personal'] as const;
export const CALL_OUTCOMES = ['answered', 'no_answer', 'busy', 'wrong_number', 'call_back'] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  leadId: uuid('lead_id'),
  assignedUserId: uuid('assigned_user_id').notNull(),
  type: text('type').$type<TaskType>().notNull(),
  title: text('title').notNull(),
  description: text('description'),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  durationMinutes: smallint('duration_minutes'),
  reminderMinutes: smallint('reminder_minutes'),
  meetingId: uuid('meeting_id'),
  status: text('status').$type<'open' | 'completed' | 'cancelled'>().notNull().default('open'),
  outcome: text('outcome').$type<CallOutcome>(),
  outcomeNote: text('outcome_note'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  completedBy: uuid('completed_by'),
  nextTaskId: uuid('next_task_id'),
  remindedAt: timestamp('reminded_at', { withTimezone: true }),
  overdueAlertedAt: timestamp('overdue_alerted_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TaskRow = typeof tasks.$inferSelect;
