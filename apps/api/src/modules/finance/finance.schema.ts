import { boolean, char, date, integer, numeric, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Finance (db/schema.sql, FINANCE): counterparties, document numbering, invoices and purchase orders with their
// lines, payments and history, and agent commissions.

export const DOC_TYPES = ['sales_invoice', 'purchase_invoice', 'purchase_order'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DOC_STATUSES = ['draft', 'approved', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled', 'refunded'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];
export const COUNTERPARTY_TYPES = ['client', 'developer', 'vendor'] as const;
export const PAYMENT_METHODS = ['bank_transfer', 'cheque', 'card', 'cash', 'other'] as const;
export const COMMISSION_STATUSES = ['pending', 'approved', 'paid', 'cancelled'] as const;
export type DocEventAction = 'created' | 'edited' | 'approved' | 'sent' | 'payment_recorded' | 'refund_recorded' | 'overdue' | 'cancelled' | 'pdf_generated';

export const counterparties = pgTable('counterparties', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  type: text('type').$type<(typeof COUNTERPARTY_TYPES)[number]>().notNull(),
  name: text('name').notNull(),
  trn: text('trn'),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  leadId: uuid('lead_id'),
  developerId: uuid('developer_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const documentSequences = pgTable('document_sequences', {
  tenantId: uuid('tenant_id').notNull(),
  docType: text('doc_type').$type<DocType>().notNull(),
  prefix: text('prefix').notNull(),
  includeYear: boolean('include_year').notNull().default(true),
  padding: smallint('padding').notNull().default(4),
  currentYear: smallint('current_year'),
  nextNumber: integer('next_number').notNull().default(1),
});

export const financeDocuments = pgTable('finance_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  docType: text('doc_type').$type<DocType>().notNull(),
  number: text('number'),
  counterpartyId: uuid('counterparty_id').notNull(),
  leadId: uuid('lead_id'),
  projectId: uuid('project_id'),
  unitId: uuid('unit_id'),
  dealId: uuid('deal_id'),
  purchaseOrderId: uuid('purchase_order_id'),
  issueDate: date('issue_date').notNull(),
  dueDate: date('due_date'),
  currency: char('currency', { length: 3 }).notNull(),
  rateToBase: numeric('rate_to_base', { precision: 18, scale: 8 }).notNull().default('1'),
  subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
  taxTotal: numeric('tax_total', { precision: 14, scale: 2 }).notNull().default('0'),
  total: numeric('total', { precision: 14, scale: 2 }).generatedAlwaysAs(''),
  amountPaid: numeric('amount_paid', { precision: 14, scale: 2 }).notNull().default('0'),
  amountRefunded: numeric('amount_refunded', { precision: 14, scale: 2 }).notNull().default('0'),
  balance: numeric('balance', { precision: 14, scale: 2 }).generatedAlwaysAs(''),
  paymentTerms: text('payment_terms'),
  notes: text('notes'),
  status: text('status').$type<DocStatus>().notNull().default('draft'),
  pdfFileId: uuid('pdf_file_id'),
  createdBy: uuid('created_by').notNull(),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  cancelledBy: uuid('cancelled_by'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const documentLines = pgTable('finance_document_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  documentId: uuid('document_id').notNull(),
  lineNo: smallint('line_no').notNull(),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
  taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull(),
  lineSubtotal: numeric('line_subtotal', { precision: 14, scale: 2 }).notNull(),
  taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull(),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  documentId: uuid('document_id').notNull(),
  kind: text('kind').$type<'payment' | 'refund'>().notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  paidOn: date('paid_on').notNull(),
  method: text('method').$type<(typeof PAYMENT_METHODS)[number]>().notNull(),
  reference: text('reference'),
  notes: text('notes'),
  proofFileId: uuid('proof_file_id'),
  recordedBy: uuid('recorded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const documentEvents = pgTable('finance_document_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  documentId: uuid('document_id').notNull(),
  action: text('action').$type<DocEventAction>().notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  paymentId: uuid('payment_id'),
  actorUserId: uuid('actor_user_id'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const commissions = pgTable('commissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  dealId: uuid('deal_id').notNull(),
  userId: uuid('user_id').notNull(),
  basis: text('basis').$type<'percentage' | 'fixed'>().notNull(),
  rate: numeric('rate', { precision: 6, scale: 3 }),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  status: text('status').$type<(typeof COMMISSION_STATUSES)[number]>().notNull().default('pending'),
  developerInvoiceId: uuid('developer_invoice_id'),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  paidOn: date('paid_on'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CounterpartyRow = typeof counterparties.$inferSelect;
export type FinanceDocumentRow = typeof financeDocuments.$inferSelect;
export type DocumentLineRow = typeof documentLines.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type DocumentEventRow = typeof documentEvents.$inferSelect;
export type CommissionRow = typeof commissions.$inferSelect;
