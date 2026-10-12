import { sql } from 'drizzle-orm';
import { bigint, boolean, char, date, inet, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Tables owned by the billing module (db/schema.sql "Platform" and "Billing"; migration 0005).

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  tenantType: text('tenant_type').$type<'brokerage' | 'individual'>(),
  priceMonthly: numeric('price_monthly', { precision: 14, scale: 2 }).notNull(),
  priceYearly: numeric('price_yearly', { precision: 14, scale: 2 }).notNull(),
  currency: char('currency', { length: 3 }).notNull().default('AED'),
  minSeats: integer('min_seats').notNull().default(1),
  maxSeats: integer('max_seats'),
  selfService: boolean('self_service').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: smallint('sort_order').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'read_only' | 'canceled';

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  planId: uuid('plan_id').notNull(),
  status: text('status').$type<SubscriptionStatus>().notNull().default('trialing'),
  billingCycle: text('billing_cycle').$type<'monthly' | 'yearly'>().notNull().default('monthly'),
  seats: integer('seats').notNull(),
  pricePerSeat: numeric('price_per_seat', { precision: 14, scale: 2 }).notNull(),
  currency: char('currency', { length: 3 }).notNull().default('AED'),
  paymentMethod: text('payment_method').$type<'card' | 'bank_transfer'>().notNull().default('card'),
  cardOnFile: boolean('card_on_file').notNull().default(false),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  dataDeleteAfter: date('data_delete_after'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  scheduledSeats: integer('scheduled_seats'),
  scheduledPlanId: uuid('scheduled_plan_id'),
  scheduledBillingCycle: text('scheduled_billing_cycle').$type<'monthly' | 'yearly'>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const SUBSCRIPTION_EVENT_TYPES = [
  'trial_started',
  'activated',
  'plan_changed',
  'seats_changed',
  'cycle_changed',
  'payment_method_changed',
  'payment_failed',
  'grace_started',
  'read_only',
  'reactivated',
  'cancel_requested',
  'canceled',
  'trial_extended',
  'suspended',
  'unsuspended',
  'data_deleted',
] as const;
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];

export const subscriptionEvents = pgTable('subscription_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  subscriptionId: uuid('subscription_id').notNull(),
  type: text('type').$type<SubscriptionEventType>().notNull(),
  oldValue: jsonb('old_value').$type<Record<string, unknown>>(),
  newValue: jsonb('new_value').$type<Record<string, unknown>>(),
  actorType: text('actor_type').$type<'user' | 'platform_admin' | 'system' | 'stripe'>().notNull(),
  actorUserId: uuid('actor_user_id'),
  platformAdminId: uuid('platform_admin_id'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const billingInvoices = pgTable('billing_invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  subscriptionId: uuid('subscription_id').notNull(),
  number: text('number').notNull(),
  status: text('status').$type<'open' | 'paid' | 'void' | 'uncollectible'>().notNull().default('open'),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  issueDate: date('issue_date').notNull(),
  dueDate: date('due_date').notNull(),
  currency: char('currency', { length: 3 }).notNull().default('AED'),
  subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull(),
  vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('5'),
  vatAmount: numeric('vat_amount', { precision: 14, scale: 2 }).notNull(),
  total: numeric('total', { precision: 14, scale: 2 }).generatedAlwaysAs(sql`subtotal + vat_amount`),
  amountPaid: numeric('amount_paid', { precision: 14, scale: 2 }).notNull().default('0'),
  balance: numeric('balance', { precision: 14, scale: 2 }).generatedAlwaysAs(sql`subtotal + vat_amount - amount_paid`),
  customerLegalName: text('customer_legal_name').notNull(),
  customerTrn: text('customer_trn'),
  customerAddress: text('customer_address'),
  pdfFileId: uuid('pdf_file_id'),
  stripeInvoiceId: text('stripe_invoice_id'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const billingInvoiceLines = pgTable('billing_invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  invoiceId: uuid('invoice_id').notNull(),
  lineNo: smallint('line_no').notNull(),
  type: text('type').$type<'subscription' | 'extra_seats' | 'credit'>().notNull(),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
});

export const billingPayments = pgTable('billing_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  invoiceId: uuid('invoice_id').notNull(),
  method: text('method').$type<'card' | 'bank_transfer'>().notNull(),
  status: text('status').$type<'pending' | 'succeeded' | 'failed' | 'refunded'>().notNull().default('pending'),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  currency: char('currency', { length: 3 }).notNull().default('AED'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  bankReference: text('bank_reference'),
  proofFileId: uuid('proof_file_id'),
  confirmedBy: uuid('confirmed_by'),
  failureReason: text('failure_reason'),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantUsageDaily = pgTable('tenant_usage_daily', {
  tenantId: uuid('tenant_id').notNull(),
  day: date('day').notNull(),
  activeUsers: integer('active_users').notNull().default(0),
  leadsCreated: integer('leads_created').notNull().default(0),
  messagesSent: integer('messages_sent').notNull().default(0),
  storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
});

export const signups = pgTable('signups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantType: text('tenant_type').$type<'brokerage' | 'individual'>().notNull(),
  companyName: text('company_name').notNull(),
  tradeLicenseNo: text('trade_license_no'),
  reraOrn: text('rera_orn'),
  reraBrn: text('rera_brn'),
  adminFullName: text('admin_full_name').notNull(),
  adminEmail: text('admin_email').notNull(),
  adminPhone: text('admin_phone').notNull(),
  planId: uuid('plan_id').notNull(),
  seats: integer('seats').notNull(),
  billingCycle: text('billing_cycle').$type<'monthly' | 'yearly'>().notNull(),
  codeHash: text('code_hash').notNull(),
  codeExpiresAt: timestamp('code_expires_at', { withTimezone: true }).notNull(),
  codeAttempts: smallint('code_attempts').notNull().default(0),
  codeSentAt: timestamp('code_sent_at', { withTimezone: true }).notNull().defaultNow(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSetupIntentId: text('stripe_setup_intent_id'),
  tenantId: uuid('tenant_id'),
  ipAddress: inet('ip_address'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const salesEnquiries = pgTable('sales_enquiries', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyName: text('company_name').notNull(),
  contactName: text('contact_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  usersEstimate: integer('users_estimate'),
  message: text('message'),
  status: text('status').$type<'new' | 'contacted' | 'won' | 'lost'>().notNull().default('new'),
  handledBy: uuid('handled_by'),
  tenantId: uuid('tenant_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PlanRow = typeof plans.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type InvoiceRow = typeof billingInvoices.$inferSelect;
export type PaymentRow = typeof billingPayments.$inferSelect;
export type SignupRow = typeof signups.$inferSelect;
