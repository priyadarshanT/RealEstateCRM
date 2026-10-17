import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// export_logs (db/schema.sql, Reports): every export with user, report, filters, format, rows and time.
export const exportLogs = pgTable('export_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  reportKey: text('report_key').notNull(),
  filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
  format: text('format').$type<'xlsx' | 'csv'>().notNull(),
  status: text('status').$type<'queued' | 'running' | 'completed' | 'failed' | 'expired'>().notNull().default('queued'),
  rowCount: integer('row_count'),
  scope: text('scope').$type<'selected' | 'filtered'>(),
  columns: text('columns').array().notNull().default([]),
  fileName: text('file_name'),
  downloadCount: integer('download_count').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  fileId: uuid('file_id'),
  errorDetail: text('error_detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
