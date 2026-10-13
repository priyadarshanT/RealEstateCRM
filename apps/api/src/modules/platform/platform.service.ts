import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, lt, or, sql, SQL } from 'drizzle-orm';
import { bigint, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PlatformAdmin } from '../../core/auth/platform-auth';
import { DbService } from '../../core/database/db.service';
import { PlatformDbService } from '../../core/database/platform-db.service';
import { ProblemException, Problems } from '../../core/errors/problem';
import { pgCode, PG_UNIQUE_VIOLATION } from '../../core/errors/pg';
import { decodeCursor, encodeCursor, Page } from '../../core/http/pagination';
import { IDENTITY_PROVIDER, IdentityProvider } from '../billing/adapters/services';
import { STRIPE_GATEWAY, StripeGateway } from '../billing/adapters/stripe-gateway';
import { addDays, BillingCoreService, isoDate, money } from '../billing/billing-core.service';
import { BillingService } from '../billing/billing.service';
import { billingInvoices, billingPayments, PlanRow, plans, platformSettings, salesEnquiries, subscriptionEvents, subscriptions } from '../billing/billing.schema';
import { BillingInvoiceDto, BillingPaymentDto, PlanDto, SalesEnquiryDto, SubscriptionDto } from '../billing/dto/billing.dto';
import { tenants } from '../organization/organization.schema';
import { OrganizationDirectory } from '../organization/directory.service';
import { OrganizationService } from '../organization/organization.service';
import { CreateCompanyDto, PlanInputDto, PlatformMetricsDto, PlatformTenantDto, SubscriptionPatchDto, TenantListQuery } from './platform.dto';
import { dayStart, dayAfter } from '../../core/http/dates';

// platform_audit_logs (db/schema.sql): every owner-console action, never changed.
export const platformAuditLogs = pgTable('platform_audit_logs', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  platformAdminId: uuid('platform_admin_id'),
  action: text('action').notNull(),
  tenantId: uuid('tenant_id'),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  changes: jsonb('changes').$type<Record<string, unknown>>(),
  ipAddress: inet('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Platform settings the owner console may change (seed.sql) and their shape. */
const SETTINGS = {
  'billing.trial': z.object({ days: z.number().int().min(0).max(90), card_required: z.boolean() }).strict(),
  'billing.grace': z.object({ days: z.number().int().min(0).max(60), then: z.literal('read_only') }).strict(),
  'billing.retention': z.object({ days_after_cancel: z.number().int().min(30).max(3650), export_available: z.boolean() }).strict(),
  'billing.vat': z.object({ rate: z.number().min(0).max(100), prices_include_vat: z.boolean() }).strict(),
  'billing.refunds': z.object({ policy: z.string().min(1) }).strict(),
  'billing.payment_methods': z.object({ card: z.boolean(), bank_transfer: z.boolean(), gateway: z.literal('stripe') }).strict(),
  'signup.verification': z.object({ brokerage: z.array(z.string()), individual: z.array(z.string()) }).strict(),
} as const;

const err = (status: number, code: string, title: string, detail: string) => new ProblemException(status, code, title, detail);

/**
 * Owner console (SRS §12 "Owner console"): companies, licence checks, bank transfers, plans and prices, trial and
 * grace extensions, suspension, sales enquiries and business metrics. It never shows a company's leads or messages.
 * Every action is written to the platform audit log.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly platform: PlatformDbService,
    private readonly db: DbService,
    private readonly core: BillingCoreService,
    private readonly billing: BillingService,
    private readonly organization: OrganizationService,
    private readonly directory: OrganizationDirectory,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
  ) {}

  // ---------------------------------------------------------------- metrics
  async metrics(): Promise<PlatformMetricsDto> {
    const since = addDays(new Date(), -30);
    const [s] = await this.platform.db
      .select({
        mrr: sql<string>`coalesce(sum(CASE WHEN ${subscriptions.status} IN ('active','past_due') THEN ${subscriptions.seats} * ${subscriptions.pricePerSeat} / CASE WHEN ${subscriptions.billingCycle} = 'yearly' THEN 12 ELSE 1 END END), 0)::text`,
        paying: sql<number>`count(*) FILTER (WHERE ${subscriptions.status} IN ('active','past_due'))::int`,
        trialing: sql<number>`count(*) FILTER (WHERE ${subscriptions.status} = 'trialing')::int`,
        pastDue: sql<number>`count(*) FILTER (WHERE ${subscriptions.status} = 'past_due')::int`,
        readOnly: sql<number>`count(*) FILTER (WHERE ${subscriptions.status} = 'read_only')::int`,
        paidSeats: sql<number>`coalesce(sum(${subscriptions.seats}) FILTER (WHERE ${subscriptions.status} IN ('active','past_due')), 0)::int`,
      })
      .from(subscriptions);
    const [e] = await this.platform.db
      .select({
        trials: sql<number>`count(*) FILTER (WHERE ${subscriptionEvents.type} = 'trial_started')::int`,
        activated: sql<number>`count(*) FILTER (WHERE ${subscriptionEvents.type} = 'activated')::int`,
        churned: sql<number>`count(*) FILTER (WHERE ${subscriptionEvents.type} = 'canceled')::int`,
      })
      .from(subscriptionEvents)
      .where(gte(subscriptionEvents.createdAt, since));
    const [pending] = await this.platform.db.select({ n: sql<number>`count(*)::int` }).from(billingPayments).where(and(eq(billingPayments.method, 'bank_transfer'), eq(billingPayments.status, 'pending')));
    const [verify] = await this.platform.db.select({ n: sql<number>`count(*)::int` }).from(tenants).where(eq(tenants.verificationStatus, 'pending'));
    const mrr = Number(s?.mrr ?? 0);
    return {
      mrr: money(mrr),
      arr: money(mrr * 12),
      payingTenants: s?.paying ?? 0,
      trialingTenants: s?.trialing ?? 0,
      pastDueTenants: s?.pastDue ?? 0,
      readOnlyTenants: s?.readOnly ?? 0,
      paidSeats: s?.paidSeats ?? 0,
      newTrials30d: e?.trials ?? 0,
      trialConversion30d: e?.trials ? Math.round(((e.activated ?? 0) / e.trials) * 1000) / 10 : 0,
      churned30d: e?.churned ?? 0,
      pendingBankTransfers: pending?.n ?? 0,
      pendingVerifications: verify?.n ?? 0,
    };
  }

  // ---------------------------------------------------------------- companies
  async tenants(q: TenantListQuery): Promise<Page<PlatformTenantDto>> {
    const where: (SQL | undefined)[] = [
      q.subscriptionStatus ? eq(subscriptions.status, q.subscriptionStatus) : undefined,
      q.verificationStatus ? eq(tenants.verificationStatus, q.verificationStatus) : undefined,
      q.planKey ? eq(plans.key, q.planKey) : undefined,
    ];
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(or(ilike(tenants.name, like), ilike(tenants.email, like), ilike(tenants.tradeLicenseNo, like), ilike(tenants.reraOrn, like), ilike(tenants.reraBrn, like)));
    }
    const offset = q.cursor ? Number(decodeCursor(q.cursor, 1)[0]) : 0;
    const rows = await this.platform.db
      .select({ id: tenants.id })
      .from(tenants)
      .innerJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(and(...where))
      .orderBy(desc(tenants.createdAt), tenants.id)
      .limit(q.limit + 1)
      .offset(offset);
    const hasMore = rows.length > q.limit;
    const data = await Promise.all(rows.slice(0, q.limit).map((r) => this.tenant(r.id)));
    return { data, page: { nextCursor: hasMore ? encodeCursor([offset + q.limit]) : null, hasMore } };
  }

  /** Profile, subscription, usage and verification. No leads or messages. */
  async tenant(id: string): Promise<PlatformTenantDto> {
    const [t] = await this.platform.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    const sub = t && (await this.core.subscriptionOf(id));
    if (!t || !sub) throw Problems.notFound();
    const [subscription, usage, people] = await Promise.all([
      this.core.dto(sub),
      this.billing.usageOf(sub),
      this.db.withTenant(id, async () => ({ adminEmail: await this.directory.firstAdminEmail(), lastLoginAt: (await this.directory.userCounts()).lastLoginAt })),
    ]);
    return {
      id: t.id,
      name: t.name,
      type: t.type,
      legalName: t.legalName,
      tradeLicenseNo: t.tradeLicenseNo,
      reraOrn: t.reraOrn,
      reraBrn: t.reraBrn,
      tradeLicenseFileId: t.tradeLicenseFileId,
      verificationStatus: t.verificationStatus,
      status: t.status,
      subscription,
      usage,
      adminEmail: people.adminEmail ?? undefined,
      createdAt: t.createdAt.toISOString(),
      lastActiveAt: people.lastLoginAt?.toISOString() ?? null,
    };
  }

  /** Licence check (trade licence + RERA ORN, or RERA BRN). WhatsApp can be connected only after verification. */
  async verify(admin: PlatformAdmin, id: string, result: 'verified' | 'rejected', note?: string): Promise<PlatformTenantDto> {
    const t = await this.tenantRow(id);
    await this.platform.db
      .update(tenants)
      .set({ verificationStatus: result, verifiedBy: result === 'verified' ? admin.id : null, verifiedAt: result === 'verified' ? new Date() : null })
      .where(eq(tenants.id, id));
    await this.log(admin, 'tenant.verify', id, 'tenants', id, { verificationStatus: [t.verificationStatus, result], note });
    if (result === 'rejected') await this.core.tellAdmins(id, 'licence_rejected', 'We could not verify your licence', note ?? 'Please contact support.');
    return this.tenant(id);
  }

  /** Blocks login for all users of the company (e.g. abuse); data is kept. */
  async suspend(admin: PlatformAdmin, id: string, reason: string): Promise<PlatformTenantDto> {
    const t = await this.tenantRow(id);
    if (t.status === 'suspended') return this.tenant(id);
    await this.platform.db.update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, id));
    const sub = await this.core.subscriptionOf(id);
    if (sub) await this.core.event(this.platform.db, sub, 'suspended', { type: 'platform_admin', adminId: admin.id }, { status: t.status }, { status: 'suspended' }, reason);
    await this.log(admin, 'tenant.suspend', id, 'tenants', id, { status: [t.status, 'suspended'], reason });
    return this.tenant(id);
  }

  async unsuspend(admin: PlatformAdmin, id: string): Promise<PlatformTenantDto> {
    const t = await this.tenantRow(id);
    if (t.status !== 'suspended') return this.tenant(id);
    await this.platform.db.update(tenants).set({ status: 'active' }).where(eq(tenants.id, id));
    const sub = await this.core.subscriptionOf(id);
    if (sub) await this.core.event(this.platform.db, sub, 'unsuspended', { type: 'platform_admin', adminId: admin.id }, { status: 'suspended' }, { status: 'active' });
    await this.log(admin, 'tenant.unsuspend', id, 'tenants', id, { status: ['suspended', 'active'] });
    return this.tenant(id);
  }

  /** Free extra days on a trial or on the grace period (a read-only company gets a new grace period). */
  async extend(admin: PlatformAdmin, id: string, days: number, note: string): Promise<PlatformTenantDto> {
    const sub = await this.core.subscriptionOf(id);
    if (!sub) throw Problems.notFound();
    const actor = { type: 'platform_admin' as const, adminId: admin.id };
    if (sub.status === 'trialing') {
      const trialEndsAt = addDays(sub.trialEndsAt ?? new Date(), days);
      if (sub.stripeSubscriptionId) await this.stripe.setTrialEnd(sub.stripeSubscriptionId, trialEndsAt);
      await this.core.update(sub, { trialEndsAt, currentPeriodEnd: trialEndsAt }, 'trial_extended', actor, note);
    } else if (sub.status === 'past_due' || sub.status === 'read_only') {
      const base = sub.status === 'past_due' && sub.graceEndsAt ? sub.graceEndsAt : new Date();
      await this.core.update(sub, { status: 'past_due', graceEndsAt: addDays(base, days) }, 'trial_extended', actor, note);
    } else {
      throw err(422, 'INVALID_STATE', 'Nothing to extend', `The subscription is ${sub.status}: only a trial or a grace period can be extended.`);
    }
    await this.log(admin, 'tenant.extend', id, 'subscriptions', sub.id, { days, note, status: sub.status });
    return this.tenant(id);
  }

  /** Enterprise deals: custom price per user, seats or plan (applies now, without a pro-rata charge). */
  async patchSubscription(admin: PlatformAdmin, subscriptionId: string, body: SubscriptionPatchDto): Promise<SubscriptionDto> {
    const [sub] = await this.platform.db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
    if (!sub) throw Problems.notFound();
    const plan = body.planId ? await this.core.plan(body.planId) : undefined;
    if (body.seats !== undefined && body.seats < (await this.core.seatsUsed(sub.tenantId))) {
      throw err(422, 'SEATS_BELOW_ACTIVE_USERS', 'Too few seats', 'Fewer seats than active users.');
    }
    const patch = {
      ...(body.pricePerSeat !== undefined ? { pricePerSeat: money(body.pricePerSeat) } : {}),
      ...(body.seats !== undefined ? { seats: body.seats } : {}),
      ...(plan ? { planId: plan.id } : {}),
    };
    if (!Object.keys(patch).length) return this.core.dto(sub);
    if (sub.stripeSubscriptionId) {
      await this.stripe.updateSubscription(sub.stripeSubscriptionId, {
        ...(body.seats !== undefined ? { seats: body.seats } : {}),
        ...(body.pricePerSeat !== undefined || plan ? { unitAmount: money(body.pricePerSeat ?? sub.pricePerSeat), currency: sub.currency, productName: `${(plan ?? (await this.core.plan(sub.planId))).name} plan` } : {}),
        prorate: false,
      });
    }
    const after = await this.core.update(sub, patch, body.seats !== undefined && !plan && body.pricePerSeat === undefined ? 'seats_changed' : 'plan_changed', { type: 'platform_admin', adminId: admin.id }, body.note);
    await this.log(admin, 'subscription.update', sub.tenantId, 'subscriptions', sub.id, { ...patch, note: body.note });
    return this.core.dto(after);
  }

  // ---------------------------------------------------------------- sales enquiries and Enterprise companies
  async enquiries(limit: number, cursor?: string, status?: string): Promise<Page<SalesEnquiryDto>> {
    const offset = cursor ? Number(decodeCursor(cursor, 1)[0]) : 0;
    const rows = await this.platform.db
      .select()
      .from(salesEnquiries)
      .where(status ? eq(salesEnquiries.status, status as 'new') : undefined)
      .orderBy(desc(salesEnquiries.createdAt))
      .limit(limit + 1)
      .offset(offset);
    const hasMore = rows.length > limit;
    return { data: rows.slice(0, limit).map(enquiryDto), page: { nextCursor: hasMore ? encodeCursor([offset + limit]) : null, hasMore } };
  }

  async updateEnquiry(admin: PlatformAdmin, id: string, status?: 'new' | 'contacted' | 'won' | 'lost', note?: string): Promise<SalesEnquiryDto> {
    const [before] = await this.platform.db.select().from(salesEnquiries).where(eq(salesEnquiries.id, id)).limit(1);
    if (!before) throw Problems.notFound();
    const [after] = await this.platform.db
      .update(salesEnquiries)
      .set({ ...(status ? { status } : {}), handledBy: admin.id, updatedAt: new Date() })
      .where(eq(salesEnquiries.id, id))
      .returning();
    await this.log(admin, 'sales_enquiry.update', null, 'sales_enquiries', id, { status: [before.status, after!.status], note });
    return enquiryDto(after!);
  }

  /** Sets up a company sold through sales with the agreed price and emails its Admin an invitation (SRS §12.7). */
  async createCompany(admin: PlatformAdmin, enquiryId: string, body: CreateCompanyDto): Promise<PlatformTenantDto> {
    const [enquiry] = await this.platform.db.select().from(salesEnquiries).where(eq(salesEnquiries.id, enquiryId)).limit(1);
    if (!enquiry) throw Problems.notFound();
    if (enquiry.tenantId) throw err(409, 'CONFLICT', 'Company already created', 'This enquiry already has a company.');
    if (body.tenantType === 'brokerage' && (!body.tradeLicenseNo || !body.reraOrn)) {
      throw new ProblemException(422, 'LICENCE_REQUIRED', 'Licence required', 'A brokerage needs its trade licence number and RERA office number (ORN).');
    }
    const enterprise = await this.core.planByKey('enterprise');
    if (!enterprise) throw new Error('The enterprise plan is missing (seed.sql)');
    const tenantId = randomUUID();
    const customerId = await this.stripe.createCustomer({ email: body.adminEmail, name: body.companyName, metadata: { tenantId } });
    const trialEndsAt = body.trialDays ? addDays(new Date(), body.trialDays) : undefined;
    const stripeSub = await this.stripe.createSubscription({
      customerId,
      seats: body.seats,
      unitAmount: money(body.pricePerSeat),
      currency: enterprise.currency,
      interval: body.billingCycle === 'yearly' ? 'year' : 'month',
      productName: `${enterprise.name} plan`,
      trialEnd: trialEndsAt,
      // No card yet: invoices are sent until the Admin adds a card.
      collection: 'send_invoice',
      metadata: { tenantId },
    });
    await this.db.withTenant(tenantId, async () => {
      await this.organization.createCompany({
        tenantId,
        type: body.tenantType,
        name: body.companyName,
        tradeLicenseNo: body.tradeLicenseNo ?? null,
        reraOrn: body.reraOrn ?? null,
        reraBrn: null,
        email: body.adminEmail,
        adminFullName: body.adminFullName,
        adminEmail: body.adminEmail,
      });
      const [sub] = await this.db.current
        .insert(subscriptions)
        .values({
          tenantId,
          planId: enterprise.id,
          status: 'active',
          billingCycle: body.billingCycle,
          seats: body.seats,
          pricePerSeat: money(body.pricePerSeat),
          currency: enterprise.currency,
          paymentMethod: body.paymentMethod,
          cardOnFile: false,
          trialEndsAt: trialEndsAt ?? null,
          currentPeriodStart: stripeSub.currentPeriodStart,
          currentPeriodEnd: stripeSub.currentPeriodEnd,
          stripeCustomerId: customerId,
          stripeSubscriptionId: stripeSub.id,
        })
        .returning();
      await this.core.event(this.db.current, sub!, 'activated', { type: 'system' }, null, { plan: 'enterprise', seats: body.seats, pricePerSeat: money(body.pricePerSeat), createdBy: admin.email });
    });
    await this.platform.db.update(salesEnquiries).set({ status: 'won', tenantId, handledBy: admin.id, updatedAt: new Date() }).where(eq(salesEnquiries.id, enquiryId));
    await this.identity.inviteUser({ email: body.adminEmail, fullName: body.adminFullName, tenantId });
    await this.log(admin, 'tenant.create', tenantId, 'tenants', tenantId, { enquiryId, seats: body.seats, pricePerSeat: money(body.pricePerSeat) });
    return this.tenant(tenantId);
  }

  // ---------------------------------------------------------------- our invoices and bank transfers
  async invoices(limit: number, cursor?: string, f: { tenantId?: string; status?: string; from?: string; to?: string } = {}): Promise<Page<BillingInvoiceDto>> {
    const offset = cursor ? Number(decodeCursor(cursor, 1)[0]) : 0;
    const rows = await this.platform.db
      .select()
      .from(billingInvoices)
      .where(
        and(
          f.tenantId ? eq(billingInvoices.tenantId, f.tenantId) : undefined,
          f.status ? eq(billingInvoices.status, f.status as 'open') : undefined,
          f.from ? gte(billingInvoices.issueDate, f.from) : undefined,
          f.to ? lt(billingInvoices.issueDate, isoDate(dayAfter(f.to))) : undefined,
        ),
      )
      .orderBy(desc(billingInvoices.issueDate), desc(billingInvoices.number))
      .limit(limit + 1)
      .offset(offset);
    const kept = rows.slice(0, limit);
    const lines = await this.core.invoiceLines(kept.map((r) => r.id));
    const hasMore = rows.length > limit;
    return { data: kept.map((i) => BillingCoreService.invoiceDto(i, lines.get(i.id), true)), page: { nextCursor: hasMore ? encodeCursor([offset + limit]) : null, hasMore } };
  }

  /** Only unpaid invoices; a corrected invoice is issued instead of editing. */
  async voidInvoice(admin: PlatformAdmin, id: string, reason: string): Promise<BillingInvoiceDto> {
    const invoice = await this.core.invoice(id);
    if (!invoice) throw Problems.notFound();
    if (invoice.status !== 'open' || Number(invoice.amountPaid) > 0) throw err(409, 'CONFLICT', 'Cannot void', 'Only unpaid invoices can be voided.');
    if (invoice.stripeInvoiceId) await this.stripe.voidInvoice(invoice.stripeInvoiceId);
    const [after] = await this.platform.db.update(billingInvoices).set({ status: 'void', updatedAt: new Date() }).where(eq(billingInvoices.id, id)).returning();
    await this.log(admin, 'invoice.void', invoice.tenantId, 'billing_invoices', id, { reason, number: invoice.number });
    return BillingCoreService.invoiceDto(after!, (await this.core.invoiceLines([id])).get(id), true);
  }

  async pendingTransfers(limit: number, cursor?: string): Promise<Page<BillingPaymentDto>> {
    const offset = cursor ? Number(decodeCursor(cursor, 1)[0]) : 0;
    const rows = await this.platform.db
      .select({ p: billingPayments, number: billingInvoices.number, tenantName: tenants.name })
      .from(billingPayments)
      .innerJoin(billingInvoices, eq(billingInvoices.id, billingPayments.invoiceId))
      .innerJoin(tenants, eq(tenants.id, billingPayments.tenantId))
      .where(and(eq(billingPayments.method, 'bank_transfer'), eq(billingPayments.status, 'pending')))
      .orderBy(billingPayments.createdAt)
      .limit(limit + 1)
      .offset(offset);
    const hasMore = rows.length > limit;
    return { data: rows.slice(0, limit).map((r) => BillingCoreService.paymentDto(r.p, { invoiceNumber: r.number, tenantName: r.tenantName })), page: { nextCursor: hasMore ? encodeCursor([offset + limit]) : null, hasMore } };
  }

  /** The money arrived: the invoice is paid and a past-due or read-only company is reactivated at once. */
  async confirmTransfer(admin: PlatformAdmin, paymentId: string, receivedAt: string, amount?: string): Promise<BillingPaymentDto> {
    const payment = await this.core.payment(paymentId);
    if (!payment || payment.method !== 'bank_transfer') throw Problems.notFound();
    if (payment.status !== 'pending') throw err(409, 'CONFLICT', 'Already handled', `This transfer is ${payment.status}.`);
    const invoice = (await this.core.invoice(payment.invoiceId))!;
    const value = amount !== undefined ? Number(amount) : Number(payment.amount);
    if (value <= 0 || value > Number(invoice.balance) + 0.001) throw err(422, 'AMOUNT_EXCEEDS_BALANCE', 'Amount too high', `The invoice balance is ${money(invoice.balance!)}.`);
    const at = new Date(receivedAt);
    const result = await this.platform.transaction(async () => {
      const [after] = await this.platform.db
        .update(billingPayments)
        .set({ status: 'succeeded', amount: money(value), receivedAt: at, confirmedBy: admin.id, updatedAt: new Date() })
        .where(eq(billingPayments.id, paymentId))
        .returning();
      const paid = await this.core.applyPayment(invoice, value, at);
      return { after: after!, paid };
    });
    if (result.paid.status === 'paid' && invoice.stripeInvoiceId) await this.stripe.payInvoiceOutOfBand(invoice.stripeInvoiceId).catch(() => undefined);
    const sub = await this.core.subscriptionOf(payment.tenantId);
    if (sub && result.paid.status === 'paid') await this.core.reactivateIfUnpaid(sub, { type: 'platform_admin', adminId: admin.id });
    await this.log(admin, 'payment.confirm', payment.tenantId, 'billing_payments', paymentId, { amount: money(value), invoice: invoice.number });
    return BillingCoreService.paymentDto(result.after, { invoiceNumber: invoice.number });
  }

  async rejectTransfer(admin: PlatformAdmin, paymentId: string, reason: string): Promise<BillingPaymentDto> {
    const payment = await this.core.payment(paymentId);
    if (!payment || payment.method !== 'bank_transfer') throw Problems.notFound();
    if (payment.status !== 'pending') throw err(409, 'CONFLICT', 'Already handled', `This transfer is ${payment.status}.`);
    const [after] = await this.platform.db.update(billingPayments).set({ status: 'failed', failureReason: reason, updatedAt: new Date() }).where(eq(billingPayments.id, paymentId)).returning();
    await this.core.tellAdmins(payment.tenantId, 'bank_transfer_rejected', 'We could not match your bank transfer', reason);
    await this.log(admin, 'payment.reject', payment.tenantId, 'billing_payments', paymentId, { reason });
    return BillingCoreService.paymentDto(after!);
  }

  // ---------------------------------------------------------------- plans and settings
  async plans(): Promise<PlanDto[]> {
    const rows = await this.platform.db.select().from(plans).orderBy(plans.sortOrder);
    return rows.map(BillingCoreService.planDto);
  }

  async createPlan(admin: PlatformAdmin, body: PlanInputDto): Promise<PlanDto> {
    const missing = (['key', 'name', 'priceMonthly', 'priceYearly'] as const).filter((f) => body[f] === undefined);
    if (missing.length) throw Problems.validation(missing.map((field) => ({ field, message: `${field} is required` })));
    const [row] = await this.platform.db
      .insert(plans)
      .values({ ...planValues(body), key: body.key!, name: body.name!, priceMonthly: money(body.priceMonthly!), priceYearly: money(body.priceYearly!) })
      .returning()
      .catch(planConflict);
    await this.log(admin, 'plan.create', null, 'plans', row!.id, { key: row!.key, priceMonthly: row!.priceMonthly });
    return BillingCoreService.planDto(row!);
  }

  /** Price changes apply to new subscriptions; existing customers keep their agreed price until changed. */
  async updatePlan(admin: PlatformAdmin, id: string, body: PlanInputDto): Promise<PlanDto> {
    const before = await this.core.plan(id);
    const [row] = await this.platform.db
      .update(plans)
      .set({ ...planValues(body), ...(body.name ? { name: body.name } : {}), ...(body.priceMonthly ? { priceMonthly: money(body.priceMonthly) } : {}), ...(body.priceYearly ? { priceYearly: money(body.priceYearly) } : {}), updatedAt: new Date() })
      .where(eq(plans.id, id))
      .returning()
      .catch(planConflict);
    await this.log(admin, 'plan.update', null, 'plans', id, diffPlan(before, row!));
    return BillingCoreService.planDto(row!);
  }

  async settings(): Promise<{ key: string; value: Record<string, unknown>; updatedAt: string }[]> {
    const rows = await this.platform.db.select().from(platformSettings).orderBy(platformSettings.key);
    return rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updatedAt.toISOString() }));
  }

  async updateSetting(admin: PlatformAdmin, key: string, value: Record<string, unknown>) {
    const schema = SETTINGS[key as keyof typeof SETTINGS];
    if (!schema) throw err(422, 'UNKNOWN_SETTING', 'Unknown setting', `There is no platform setting called "${key}".`);
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw Problems.validation(parsed.error.issues.map((i) => ({ field: ['value', ...i.path].join('.'), message: i.message })));
    const [before] = await this.platform.db.select().from(platformSettings).where(eq(platformSettings.key, key)).limit(1);
    const [row] = await this.platform.db
      .insert(platformSettings)
      .values({ key, value: parsed.data as Record<string, unknown>, updatedBy: admin.id })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: parsed.data as Record<string, unknown>, updatedBy: admin.id, updatedAt: new Date() } })
      .returning();
    await this.log(admin, 'setting.update', null, 'platform_settings', null, { key, value: [before?.value ?? null, row!.value] });
    return { key: row!.key, value: row!.value, updatedAt: row!.updatedAt.toISOString() };
  }

  // ---------------------------------------------------------------- audit
  async auditLog(limit: number, cursor?: string, tenantId?: string, from?: string, to?: string) {
    const after = cursor ? Number(decodeCursor(cursor, 1)[0]) : undefined;
    const rows = await this.platform.db
      .select()
      .from(platformAuditLogs)
      .where(
        and(
          tenantId ? eq(platformAuditLogs.tenantId, tenantId) : undefined,
          from ? gte(platformAuditLogs.createdAt, dayStart(from)) : undefined,
          to ? lt(platformAuditLogs.createdAt, dayAfter(to)) : undefined,
          after !== undefined ? lt(platformAuditLogs.id, after) : undefined,
        ),
      )
      .orderBy(desc(platformAuditLogs.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const kept = rows.slice(0, limit);
    return {
      data: kept.map((r) => ({
        id: r.id,
        userId: r.platformAdminId,
        action: r.action,
        entityType: r.entityType ?? '',
        entityId: r.entityId,
        changes: r.changes,
        ipAddress: r.ipAddress,
        createdAt: r.createdAt.toISOString(),
      })),
      page: { nextCursor: hasMore ? encodeCursor([kept[kept.length - 1]!.id]) : null, hasMore },
    };
  }

  /** Every owner-console action (SRS §12.5). */
  async log(admin: PlatformAdmin | null, action: string, tenantId: string | null, entityType: string | null, entityId: string | null, changes: Record<string, unknown>, ip?: string): Promise<void> {
    await this.platform.db.insert(platformAuditLogs).values({ platformAdminId: admin?.id ?? null, action, tenantId, entityType, entityId, changes, ipAddress: ip ?? null });
  }

  private async tenantRow(id: string) {
    const [t] = await this.platform.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    if (!t) throw Problems.notFound();
    return t;
  }

}

function enquiryDto(e: typeof salesEnquiries.$inferSelect): SalesEnquiryDto {
  return { id: e.id, companyName: e.companyName, contactName: e.contactName, email: e.email, phone: e.phone, usersEstimate: e.usersEstimate, message: e.message, status: e.status, createdAt: e.createdAt.toISOString() };
}

function planValues(b: PlanInputDto): Partial<PlanRow> {
  return {
    ...(b.description !== undefined ? { description: b.description } : {}),
    ...(b.tenantType !== undefined ? { tenantType: b.tenantType } : {}),
    ...(b.currency ? { currency: b.currency } : {}),
    ...(b.minSeats !== undefined ? { minSeats: b.minSeats } : {}),
    ...(b.maxSeats !== undefined ? { maxSeats: b.maxSeats } : {}),
    ...(b.selfService !== undefined ? { selfService: b.selfService } : {}),
    ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
  };
}

function diffPlan(a: PlanRow, b: PlanRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(b) as (keyof PlanRow)[]) if (k !== 'updatedAt' && String(a[k]) !== String(b[k])) out[k] = [a[k], b[k]];
  return out;
}

function planConflict(e: unknown): never {
  if (pgCode(e) === PG_UNIQUE_VIOLATION) throw new ProblemException(409, 'CONFLICT', 'Plan key taken', 'A plan with this key already exists.');
  if (pgCode(e) === '23514') throw Problems.validation([{ field: 'maxSeats', message: 'must be at least minSeats' }]);
  throw e;
}
