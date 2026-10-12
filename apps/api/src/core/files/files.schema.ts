import { bigint, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// files and attachments (db/schema.sql, "Shared"): every stored file, and links from a file to exactly one record.

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  storageKey: text('storage_key').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  checksumSha256: text('checksum_sha256'),
  uploadedBy: uuid('uploaded_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const ATTACHMENT_CATEGORIES = ['document', 'image', 'brochure', 'floor_plan', 'contract', 'id_document', 'receipt', 'other'] as const;
export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number];

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  fileId: uuid('file_id').notNull(),
  category: text('category').$type<AttachmentCategory>().notNull(),
  leadId: uuid('lead_id'),
  projectId: uuid('project_id'),
  unitId: uuid('unit_id'),
  dealId: uuid('deal_id'),
  financeDocumentId: uuid('finance_document_id'),
  commissionId: uuid('commission_id'),
  sortOrder: smallint('sort_order').notNull().default(0),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type FileRow = typeof files.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
