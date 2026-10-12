import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { SubscriptionStatusProvider } from '../../core/auth/principal';
import { Database, DbService } from '../../core/database/db.service';
import { PlatformDbService } from '../../core/database/platform-db.service';
import { Problems } from '../../core/errors/problem';
import { MAILER, Mailer } from '../../core/mail/mailer';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganizationDirectory } from '../organization/directory.service';
import {
  billingInvoiceLines,
  billingInvoices,
  billingPayments,
  InvoiceRow,
  PaymentRow,
  PlanRow,
  plans,
  platformSettings,
  SubscriptionEventType,
  SubscriptionRow,
  subscriptionEvents,
  subscriptions,
  SubscriptionStatus,
} from './billing.schema';
import { BillingInvoiceDto, BillingPaymentDto, PlanDto, SubscriptionDto } from './dto/billing.dto';

export interface BillingSettings {
  trialDays: number;
  graceDays: number;
  retentionDays: number;
  vatRate: number;
}

export type Actor = { type: 'user'; userId: string } | { type: 'platform_admin'; adminId: string } | { type: 'system' } | { type: 'stripe' };

export const money = (v: number | string): string => Number(v).toFixed(2);
export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Shared billing rules (SRS §12): subscription state, history, our tax invoices and payments. What tenant users may
 * not change themselves (status, plan price, invoices, payments) is written through the platform connection
 * (security.sql); everything is recorded in the subscription history.
 */
@Injectable()
export class BillingCoreService implements SubscriptionStatusProvider {
  constructor(
    private readonly db: DbService,
    private readonly platform: PlatformDbService,
    private readonly directory: OrganizationDirectory,
    private readonly notifications: NotificationsService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  // ---------------------------------------------------------------- settings and plans
  async settings(): Promise<BillingSettings> {
    const rows = await this.platform.db.select().from(platformSettings);
    const v = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, Record<string, number>>;
    return {
      trialDays: v['billing.trial']?.days ?? 14,
      graceDays: v['billing.grace']?.days ?? 14,
      retentionDays: v['billing.retention']?.days_after_cancel ?? 90,
      vatRate: v['billing.vat']?.rate ?? 5,
    };
  }

  async activePlans(): Promise<PlanRow[]> {
    return this.platform.db.select().from(plans).where(eq(plans.isActive, true)).orderBy(asc(plans.sortOrder));
  }

  async plan(id: string): Promise<PlanRow> {
    const [row] = await this.platform.db.select().from(plans).where(eq(plans.id, id)).limit(1);
    if (!row) throw Problems.validation([{ field: 'planId', message: 'unknown plan' }]);
    return row;
  }

  async planByKey(key: string): Promise<PlanRow | undefined> {
    const [row] = await this.platform.db.select().from(plans).where(eq(plans.key, key)).limit(1);
    return row;
  }

  static planDto(p: PlanRow): PlanDto {
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      tenantType: p.tenantType,
      priceMonthly: money(p.priceMonthly),
      priceYearly: money(p.priceYearly),
      currency: p.currency,
      minSeats: p.minSeats,
      maxSeats: p.maxSeats,
      selfService: p.selfService,
      isActive: p.isActive,
    };
  }

  /** Price per user for a cycle (per month or per year), excluding VAT. */
  static price(plan: PlanRow, cycle: 'monthly' | 'yearly'): string {
    return money(cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly);
  }

  // ---------------------------------------------------------------- subscription
  async subscriptionOf(tenantId: string): Promise<SubscriptionRow | undefined> {
    const [row] = await this.platform.db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1);
    return row;
  }

  async subscriptionByStripe(customerId: string | null, subscriptionId?: string | null): Promise<SubscriptionRow | undefined> {
    const where = subscriptionId ? eq(subscriptions.stripeSubscriptionId, subscriptionId) : customerId ? eq(subscriptions.stripeCustomerId, customerId) : undefined;
    if (!where) return undefined;
    const [row] = await this.platform.db.select().from(subscriptions).where(where).limit(1);
    if (row || !subscriptionId || !customerId) return row;
    return this.subscriptionByStripe(customerId, null);
  }

  /** Subscription as the screens show it. Seats used and the card are read for the subscription's tenant. */
  async dto(sub: SubscriptionRow, cardLast4: string | null = null): Promise<SubscriptionDto> {
    const [plan, settings, counts] = await Promise.all([
      this.plan(sub.planId),
      this.settings(),
      this.db.withTenant(sub.tenantId, () => this.directory.userCounts()),
    ]);
    const seats = sub.scheduledSeats ?? sub.seats;
    const price = Number(sub.pricePerSeat);
    const subtotal = seats * price;
    const vat = Math.round(subtotal * settings.vatRate) / 100;
    const nextDate = sub.status === 'trialing' ? sub.trialEndsAt : sub.currentPeriodEnd;
    return {
      id: sub.id,
      plan: BillingCoreService.planDto(plan),
      status: sub.status,
      billingCycle: sub.billingCycle,
      seats: sub.seats,
      seatsUsed: counts.active,
      pricePerSeat: money(sub.pricePerSeat),
      currency: sub.currency,
      paymentMethod: sub.paymentMethod,
      cardLast4,
      trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      graceEndsAt: sub.graceEndsAt?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      dataDeleteAfter: sub.dataDeleteAfter,
      nextInvoiceEstimate: { subtotal: money(subtotal), vat: money(vat), total: money(subtotal + vat), date: nextDate ? isoDate(nextDate) : null },
    };
  }

  /** Changes what tenant users may not change themselves, and records it in the history. */
  async update(sub: SubscriptionRow, patch: Partial<SubscriptionRow>, event: SubscriptionEventType, actor: Actor, note?: string, oldValue?: Record<string, unknown>, newValue?: Record<string, unknown>) {
    return this.platform.transaction(async () => {
      const [after] = await this.platform.db
        .update(subscriptions)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id))
        .returning();
      await this.event(this.platform.db, after!, event, actor, oldValue ?? pick(sub, Object.keys(patch)), newValue ?? pick(after!, Object.keys(patch)), note);
      return after!;
    });
  }

  async event(db: Database, sub: SubscriptionRow, type: SubscriptionEventType, actor: Actor, oldValue?: Record<string, unknown> | null, newValue?: Record<string, unknown> | null, note?: string) {
    await db.insert(subscriptionEvents).values({
      tenantId: sub.tenantId,
      subscriptionId: sub.id,
      type,
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
      actorType: actor.type,
      actorUserId: actor.type === 'user' ? actor.userId : null,
      platformAdminId: actor.type === 'platform_admin' ? actor.adminId : null,
      note: note ?? null,
    });
  }

  /** Read-only (SRS §12 "If a payment fails"): unpaid after the grace period, or cancelled after the paid period. */
  async isReadOnly(tenantId: string): Promise<boolean> {
    const [row] = await this.db.current.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1);
    return row?.status === 'read_only' || row?.status === 'canceled';
  }

  /** Paying reactivates the company at once (SRS §12). */
  async reactivateIfUnpaid(sub: SubscriptionRow, actor: Actor): Promise<SubscriptionRow> {
    if (sub.status !== 'past_due' && sub.status !== 'read_only') return sub;
    const after = await this.update(sub, { status: 'active', graceEndsAt: null }, 'reactivated', actor);
    await this.tellAdmins(sub.tenantId, 'billing_reactivated', 'Payment received: your account is fully active again.');
    return after;
  }

  async setStatus(sub: SubscriptionRow, status: SubscriptionStatus, patch: Partial<SubscriptionRow>, event: SubscriptionEventType, actor: Actor, note?: string) {
    return this.update(sub, { status, ...patch }, event, actor, note);
  }

  // ---------------------------------------------------------------- invoices and payments
  /** Next free tax invoice number CRM-YYYY-NNNNNN (numbers already used, e.g. imported ones, are skipped). */
  async nextInvoiceNumber(): Promise<string> {
    for (;;) {
      const result = await this.platform.db.execute<{ n: string }>(sql`SELECT nextval('billing_invoice_number_seq')::text AS n`);
      const number = `CRM-${new Date().getUTCFullYear()}-${result.rows[0]!.n.padStart(6, '0')}`;
      const used = await this.platform.db.select({ id: billingInvoices.id }).from(billingInvoices).where(eq(billingInvoices.number, number)).limit(1);
      if (!used.length) return number;
    }
  }

  async invoiceLines(invoiceIds: string[], db: Database = this.platform.db) {
    if (!invoiceIds.length) return new Map<string, (typeof billingInvoiceLines.$inferSelect)[]>();
    const rows = await db.select().from(billingInvoiceLines).where(inArray(billingInvoiceLines.invoiceId, invoiceIds)).orderBy(asc(billingInvoiceLines.lineNo));
    const map = new Map<string, (typeof billingInvoiceLines.$inferSelect)[]>();
    for (const r of rows) map.set(r.invoiceId, [...(map.get(r.invoiceId) ?? []), r]);
    return map;
  }

  static invoiceDto(i: InvoiceRow, lines: (typeof billingInvoiceLines.$inferSelect)[] = [], withTenant = false): BillingInvoiceDto {
    return {
      id: i.id,
      number: i.number,
      status: i.status,
      periodStart: i.periodStart,
      periodEnd: i.periodEnd,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      currency: i.currency,
      lines: lines.map((l) => ({ type: l.type, description: l.description, quantity: l.quantity, unitPrice: money(l.unitPrice), amount: money(l.amount) })),
      subtotal: money(i.subtotal),
      vatRate: money(i.vatRate),
      vatAmount: money(i.vatAmount),
      total: money(i.total!),
      amountPaid: money(i.amountPaid),
      balance: money(i.balance!),
      paidAt: i.paidAt?.toISOString() ?? null,
      ...(withTenant ? { tenantId: i.tenantId } : {}),
    };
  }

  static paymentDto(p: PaymentRow, extra: { invoiceNumber?: string; tenantName?: string } = {}): BillingPaymentDto {
    return {
      id: p.id,
      invoiceId: p.invoiceId,
      invoiceNumber: extra.invoiceNumber,
      tenantId: p.tenantId,
      tenantName: extra.tenantName,
      method: p.method,
      status: p.status,
      amount: money(p.amount),
      currency: p.currency,
      bankReference: p.bankReference,
      proofFileId: p.proofFileId,
      failureReason: p.failureReason,
      receivedAt: p.receivedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    };
  }

  /** Adds a payment to an invoice; a fully paid invoice is marked paid. Returns the invoice after. */
  async applyPayment(invoice: InvoiceRow, amount: number, at: Date): Promise<InvoiceRow> {
    const paid = Number(invoice.amountPaid) + amount;
    const full = paid + 0.001 >= Number(invoice.total);
    const [after] = await this.platform.db
      .update(billingInvoices)
      .set({ amountPaid: money(paid), ...(full ? { status: 'paid' as const, paidAt: at } : {}), updatedAt: new Date() })
      .where(eq(billingInvoices.id, invoice.id))
      .returning();
    return after!;
  }

  async invoice(id: string): Promise<InvoiceRow | undefined> {
    const [row] = await this.platform.db.select().from(billingInvoices).where(eq(billingInvoices.id, id)).limit(1);
    return row;
  }

  async payment(id: string): Promise<PaymentRow | undefined> {
    const [row] = await this.platform.db.select().from(billingPayments).where(eq(billingPayments.id, id)).limit(1);
    return row;
  }

  // ---------------------------------------------------------------- telling the company's admins
  /** In-app notice and email to the company's Admins (e.g. "Payment failed, please update your card"). */
  async tellAdmins(tenantId: string, type: string, title: string, body?: string): Promise<void> {
    const admins = await this.db.withTenant(tenantId, async () => {
      const list = await this.directory.admins();
      for (const a of list) await this.notifications.notify({ userId: a.id, type, title, body });
      return list;
    });
    for (const a of admins) await this.mailer.send({ to: a.email, subject: title, text: body ?? title });
  }

  async seatsUsed(tenantId: string): Promise<number> {
    return (await this.db.withTenant(tenantId, () => this.directory.userCounts())).active;
  }
}

function pick<T extends object>(row: T, keys: string[]): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, r[k] instanceof Date ? (r[k] as Date).toISOString() : r[k]]));
}

