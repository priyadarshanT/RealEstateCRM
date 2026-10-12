import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { APP_CONFIG, AppConfig } from '../../core/config/app-config';
import { DbService } from '../../core/database/db.service';
import { PlatformDbService } from '../../core/database/platform-db.service';
import { ProblemException, Problems } from '../../core/errors/problem';
import { FilesService } from '../../core/files/files.service';
import { decodeCursor, encodeCursor, Page } from '../../core/http/pagination';
import { OrganizationDirectory } from '../organization/directory.service';
import { OrganizationService } from '../organization/organization.service';
import { STRIPE_GATEWAY, StripeGateway } from './adapters/stripe-gateway';
import { PDF_RENDERER, PdfRenderer } from './adapters/services';
import { Actor, BillingCoreService, money } from './billing-core.service';
import { billingInvoices, billingPayments, SubscriptionRow, subscriptionEvents, subscriptions, tenantUsageDaily } from './billing.schema';
import {
  BankTransferDto,
  BillingInvoiceDto,
  BillingPaymentDto,
  BillingUsageDto,
  CardSetupDto,
  ChangePlanDto,
  SubscriptionDto,
  SubscriptionEventDto,
} from './dto/billing.dto';
import { invoiceHtml } from './invoice-html';

const err = (status: number, code: string, title: string, detail: string) => new ProblemException(status, code, title, detail);

/**
 * Organization Profile → Billing for the company's Admin (SRS §12): plan, seats, payment method, card, cancel and
 * resume, our tax invoices and payments, usage and history. Reads go through the tenant's own connection
 * (row-level security); changes the app may not make itself go through BillingCoreService.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly core: BillingCoreService,
    private readonly db: DbService,
    private readonly platform: PlatformDbService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly directory: OrganizationDirectory,
    private readonly organization: OrganizationService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
    @Inject(PDF_RENDERER) private readonly pdf: PdfRenderer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async subscription(p: Principal): Promise<SubscriptionDto> {
    const sub = await this.mine(p);
    const card = sub.paymentMethod === 'card' && sub.stripeCustomerId ? await this.stripe.cardLast4(sub.stripeCustomerId).catch(() => null) : null;
    return this.core.dto(sub, card);
  }

  /** Upgrades and a switch to yearly apply now (pro-rata); downgrades and a switch to monthly from the next renewal. */
  async changePlan(p: Principal, body: ChangePlanDto): Promise<SubscriptionDto> {
    const sub = await this.mine(p);
    this.assertNotCanceled(sub);
    const plan = await this.core.plan(body.planId);
    const tenantType = (await this.tenantType(p)) as 'brokerage' | 'individual';
    if (!plan.isActive || !plan.selfService) throw err(422, 'PLAN_NOT_SELF_SERVICE', 'Talk to our sales team', `The ${plan.name} plan is arranged through our sales team.`);
    if (plan.tenantType && plan.tenantType !== tenantType) throw err(422, 'PLAN_NOT_ALLOWED', 'Plan not available', `The ${plan.name} plan is not available for this kind of company.`);
    if (sub.seats < plan.minSeats || (plan.maxSeats !== null && sub.seats > plan.maxSeats)) {
      throw err(422, 'PLAN_NOT_ALLOWED', 'Plan not available', `The ${plan.name} plan allows ${plan.minSeats}${plan.maxSeats ? `–${plan.maxSeats}` : ' or more'} users.`);
    }
    const cycle = body.billingCycle ?? sub.billingCycle;
    const price = BillingCoreService.price(plan, cycle);
    const perMonth = (amount: string, c: string) => Number(amount) / (c === 'yearly' ? 12 : 1);
    const now = perMonth(price, cycle) >= perMonth(sub.pricePerSeat, sub.billingCycle) || (cycle === 'yearly' && sub.billingCycle === 'monthly');
    const actor: Actor = { type: 'user', userId: p.userId };
    if (plan.id === sub.planId && cycle === sub.billingCycle) return this.subscription(p);

    if (now) {
      if (sub.stripeSubscriptionId) {
        await this.stripe.updateSubscription(sub.stripeSubscriptionId, { unitAmount: price, currency: plan.currency, interval: cycle === 'yearly' ? 'year' : 'month', productName: `${plan.name} plan`, prorate: sub.status !== 'trialing' });
      }
      const type = plan.id !== sub.planId ? 'plan_changed' : 'cycle_changed';
      await this.core.update(sub, { planId: plan.id, billingCycle: cycle, pricePerSeat: price, scheduledPlanId: null, scheduledBillingCycle: null }, type, actor);
    } else {
      // From the next renewal: the app may set these columns itself (security.sql grants).
      await this.db.current
        .update(subscriptions)
        .set({ scheduledPlanId: plan.id === sub.planId ? null : plan.id, scheduledBillingCycle: cycle === sub.billingCycle ? null : cycle })
        .where(eq(subscriptions.id, sub.id));
      await this.core.event(this.db.current, sub, plan.id !== sub.planId ? 'plan_changed' : 'cycle_changed', actor, { plan: sub.planId, billingCycle: sub.billingCycle }, { plan: plan.id, billingCycle: cycle, from: 'next renewal' });
    }
    await this.audit.record('setting_change', 'subscriptions', sub.id, { planId: [sub.planId, plan.id], billingCycle: [sub.billingCycle, cycle] });
    return this.subscription(p);
  }

  /** More seats: charged pro-rata now. Fewer: from the next renewal, never below the active users (SRS §12 Seats). */
  async changeSeats(p: Principal, seats: number): Promise<SubscriptionDto> {
    const sub = await this.mine(p);
    this.assertNotCanceled(sub);
    const used = await this.core.seatsUsed(sub.tenantId);
    if (seats < used) throw err(422, 'SEATS_BELOW_ACTIVE_USERS', 'Too few seats', `${used} users are active. Deactivate users before reducing seats.`);
    const plan = await this.core.plan(sub.planId);
    if (seats < plan.minSeats || (plan.maxSeats !== null && seats > plan.maxSeats)) {
      throw Problems.validation([{ field: 'seats', message: `the ${plan.name} plan allows ${plan.minSeats}${plan.maxSeats ? `–${plan.maxSeats}` : ' or more'} users` }]);
    }
    const actor: Actor = { type: 'user', userId: p.userId };
    if (seats > sub.seats) {
      if (sub.stripeSubscriptionId) await this.stripe.updateSubscription(sub.stripeSubscriptionId, { seats, prorate: sub.status !== 'trialing' });
      await this.db.current.update(subscriptions).set({ seats, scheduledSeats: null }).where(eq(subscriptions.id, sub.id));
      await this.core.event(this.db.current, sub, 'seats_changed', actor, { seats: sub.seats }, { seats });
    } else {
      await this.db.current.update(subscriptions).set({ scheduledSeats: seats === sub.seats ? null : seats }).where(eq(subscriptions.id, sub.id));
      await this.core.event(this.db.current, sub, 'seats_changed', actor, { seats: sub.seats }, { seats, from: 'next renewal' });
    }
    await this.audit.record('setting_change', 'subscriptions', sub.id, { seats: [sub.seats, seats] });
    return this.subscription(p);
  }

  /** Card (charged automatically) or bank transfer (invoices emailed, paid by transfer). */
  async changePaymentMethod(p: Principal, method: 'card' | 'bank_transfer'): Promise<SubscriptionDto> {
    const sub = await this.mine(p);
    if (sub.paymentMethod === method) return this.subscription(p);
    if (method === 'card' && !sub.cardOnFile) throw err(422, 'CARD_REQUIRED', 'Card required', 'Add a card first.');
    if (sub.stripeSubscriptionId) await this.stripe.updateSubscription(sub.stripeSubscriptionId, { prorate: false, collection: method === 'card' ? 'charge_automatically' : 'send_invoice' });
    await this.db.current.update(subscriptions).set({ paymentMethod: method }).where(eq(subscriptions.id, sub.id));
    await this.core.event(this.db.current, sub, 'payment_method_changed', { type: 'user', userId: p.userId }, { paymentMethod: sub.paymentMethod }, { paymentMethod: method });
    return this.subscription(p);
  }

  async cardSetup(p: Principal): Promise<CardSetupDto> {
    const sub = await this.mine(p);
    if (!sub.stripeCustomerId) throw err(422, 'INVALID_STATE', 'No billing account', 'This company has no Stripe customer yet.');
    const intent = await this.stripe.createSetupIntent(sub.stripeCustomerId);
    return { stripePublishableKey: this.config.STRIPE_PUBLISHABLE_KEY, setupIntentClientSecret: intent.clientSecret };
  }

  /** Cancel at the end of the paid period; no refund for the started period (SRS §12 Cancelling). */
  async cancel(p: Principal, reason?: string): Promise<SubscriptionDto> {
    const sub = await this.mine(p);
    this.assertNotCanceled(sub);
    if (sub.cancelAtPeriodEnd) return this.subscription(p);
    if (sub.stripeSubscriptionId) await this.stripe.setCancelAtPeriodEnd(sub.stripeSubscriptionId, true);
    await this.db.current.update(subscriptions).set({ cancelAtPeriodEnd: true }).where(eq(subscriptions.id, sub.id));
    await this.core.event(this.db.current, sub, 'cancel_requested', { type: 'user', userId: p.userId }, { cancelAtPeriodEnd: false }, { cancelAtPeriodEnd: true }, reason);
    return this.subscription(p);
  }

  /** Undo the cancellation, only before the period ends. */
  async resume(p: Principal): Promise<SubscriptionDto> {
    const sub = await this.mine(p);
    if (sub.status === 'canceled') throw err(422, 'INVALID_STATE', 'Already ended', 'The subscription has already ended.');
    if (!sub.cancelAtPeriodEnd) return this.subscription(p);
    if (sub.stripeSubscriptionId) await this.stripe.setCancelAtPeriodEnd(sub.stripeSubscriptionId, false);
    await this.db.current.update(subscriptions).set({ cancelAtPeriodEnd: false }).where(eq(subscriptions.id, sub.id));
    await this.core.event(this.db.current, sub, 'cancel_requested', { type: 'user', userId: p.userId }, { cancelAtPeriodEnd: true }, { cancelAtPeriodEnd: false }, 'Cancellation withdrawn');
    return this.subscription(p);
  }

  // ---------------------------------------------------------------- invoices and payments
  async invoices(limit: number, cursor?: string, status?: string): Promise<Page<BillingInvoiceDto>> {
    const offset = cursor ? Number(decodeCursor(cursor, 1)[0]) : 0;
    const rows = await this.db.current
      .select()
      .from(billingInvoices)
      .where(status ? eq(billingInvoices.status, status as 'open') : undefined)
      .orderBy(desc(billingInvoices.issueDate), desc(billingInvoices.number))
      .limit(limit + 1)
      .offset(offset);
    const kept = rows.slice(0, limit);
    const lines = await this.core.invoiceLines(kept.map((r) => r.id), this.db.current);
    const hasMore = rows.length > limit;
    return { data: kept.map((i) => BillingCoreService.invoiceDto(i, lines.get(i.id))), page: { nextCursor: hasMore ? encodeCursor([offset + limit]) : null, hasMore } };
  }

  async invoice(id: string): Promise<BillingInvoiceDto> {
    const row = await this.ownInvoice(id);
    return BillingCoreService.invoiceDto(row, (await this.core.invoiceLines([id], this.db.current)).get(id));
  }

  /** UAE tax invoice with our TRN and 5% VAT, made once and kept (Gotenberg). */
  async invoicePdf(id: string): Promise<{ url: string; expiresAt: string }> {
    const row = await this.ownInvoice(id);
    let fileId = row.pdfFileId;
    if (!fileId) {
      const lines = (await this.core.invoiceLines([id], this.db.current)).get(id) ?? [];
      const body = await this.pdf.render(invoiceHtml(row, lines));
      const file = await this.files.store(`${row.number}.pdf`, 'application/pdf', body, 'billing', undefined, { db: this.platform.db, tenantId: row.tenantId });
      await this.platform.db.update(billingInvoices).set({ pdfFileId: file.id }).where(eq(billingInvoices.id, id));
      fileId = file.id;
    }
    return this.files.systemDownloadLink(fileId);
  }

  /** The Admin enters the transfer reference (and receipt); our team confirms when the money arrives. */
  async submitBankTransfer(p: Principal, invoiceId: string, body: BankTransferDto): Promise<BillingPaymentDto> {
    const invoice = await this.ownInvoice(invoiceId);
    if (invoice.status !== 'open') throw err(409, 'CONFLICT', 'Invoice not open', `This invoice is ${invoice.status}.`);
    const amount = Number(body.amount);
    if (amount <= 0 || amount > Number(invoice.balance) + 0.001) throw err(422, 'AMOUNT_EXCEEDS_BALANCE', 'Amount too high', `The balance of this invoice is ${money(invoice.balance!)} ${invoice.currency}.`);
    const [row] = await this.platform.db
      .insert(billingPayments)
      .values({ tenantId: p.tenantId, invoiceId, method: 'bank_transfer', status: 'pending', amount: money(amount), currency: invoice.currency, bankReference: body.bankReference, proofFileId: body.proofFileId ?? null })
      .returning()
      .catch((e) => {
        if ((e as { cause?: { code?: string } }).cause?.code === '23503') throw Problems.validation([{ field: 'proofFileId', message: 'file not found' }]);
        throw e;
      });
    await this.audit.record('create', 'billing_payments', row!.id, { bankReference: [null, body.bankReference], amount: [null, money(amount)] });
    return BillingCoreService.paymentDto(row!, { invoiceNumber: invoice.number });
  }

  async payments(limit: number, cursor?: string): Promise<Page<BillingPaymentDto>> {
    const offset = cursor ? Number(decodeCursor(cursor, 1)[0]) : 0;
    const rows = await this.db.current
      .select({ p: billingPayments, number: billingInvoices.number })
      .from(billingPayments)
      .innerJoin(billingInvoices, eq(billingInvoices.id, billingPayments.invoiceId))
      .orderBy(desc(billingPayments.createdAt))
      .limit(limit + 1)
      .offset(offset);
    const hasMore = rows.length > limit;
    return { data: rows.slice(0, limit).map((r) => BillingCoreService.paymentDto(r.p, { invoiceNumber: r.number })), page: { nextCursor: hasMore ? encodeCursor([offset + limit]) : null, hasMore } };
  }

  async usage(p: Principal): Promise<BillingUsageDto> {
    const sub = await this.mine(p);
    return this.usageOf(sub);
  }

  /** Seats, invited users and this month's usage (from the nightly usage figures plus today's users). */
  async usageOf(sub: SubscriptionRow): Promise<BillingUsageDto> {
    const counts = await this.db.withTenant(sub.tenantId, () => this.directory.userCounts());
    const month = new Date();
    month.setUTCDate(1);
    const [row] = await this.platform.db
      .select({
        leads: sql<number>`coalesce(sum(${tenantUsageDaily.leadsCreated}), 0)::int`,
        messages: sql<number>`coalesce(sum(${tenantUsageDaily.messagesSent}), 0)::int`,
        storage: sql<number>`coalesce(max(${tenantUsageDaily.storageBytes}), 0)::bigint`,
      })
      .from(tenantUsageDaily)
      .where(and(eq(tenantUsageDaily.tenantId, sub.tenantId), gte(tenantUsageDaily.day, month.toISOString().slice(0, 10))));
    return { seats: sub.seats, seatsUsed: counts.active, invitedUsers: counts.invited, leadsThisMonth: row?.leads ?? 0, messagesThisMonth: row?.messages ?? 0, storageBytes: Number(row?.storage ?? 0) };
  }

  async history(limit: number, cursor?: string): Promise<Page<SubscriptionEventDto>> {
    const offset = cursor ? Number(decodeCursor(cursor, 1)[0]) : 0;
    const rows = await this.db.current
      .select()
      .from(subscriptionEvents)
      .orderBy(desc(subscriptionEvents.createdAt))
      .limit(limit + 1)
      .offset(offset);
    const kept = rows.slice(0, limit);
    const names = await this.directory.users(kept.map((r) => r.actorUserId).filter((v): v is string => Boolean(v)));
    const hasMore = rows.length > limit;
    return {
      data: kept.map((e) => ({
        id: e.id,
        type: e.type,
        oldValue: e.oldValue,
        newValue: e.newValue,
        actorType: e.actorType,
        actorName: e.actorUserId ? (names.get(e.actorUserId)?.fullName ?? null) : e.actorType === 'platform_admin' ? 'CRM support team' : null,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
      page: { nextCursor: hasMore ? encodeCursor([offset + limit]) : null, hasMore },
    };
  }

  private async mine(p: Principal): Promise<SubscriptionRow> {
    const [row] = await this.db.current.select().from(subscriptions).where(eq(subscriptions.tenantId, p.tenantId)).limit(1);
    if (!row) throw Problems.notFound('This company has no subscription.');
    return row;
  }

  private async ownInvoice(id: string) {
    const [row] = await this.db.current.select().from(billingInvoices).where(eq(billingInvoices.id, id)).limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }

  private async tenantType(p: Principal): Promise<string> {
    return (await this.organization.getProfile(p.tenantId)).type;
  }

  private assertNotCanceled(sub: SubscriptionRow): void {
    if (sub.status === 'canceled') throw err(422, 'INVALID_STATE', 'Subscription ended', 'This subscription has ended.');
  }
}
