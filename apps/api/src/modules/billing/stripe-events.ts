import { Controller, HttpCode, Inject, Injectable, Logger, OnModuleInit, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import { Request } from 'express';
import { Public } from '../../core/auth/decorators';
import { DbService } from '../../core/database/db.service';
import { PlatformDbService } from '../../core/database/platform-db.service';
import { Problems } from '../../core/errors/problem';
import { QueueService } from '../../core/queue/queue.service';
import { WebhookAck } from '../integrations/meta/meta-webhook';
import { webhookEvents } from '../integrations/integrations.schema';
import { OrganizationService } from '../organization/organization.service';
import { STRIPE_GATEWAY, StripeEvent, StripeGateway } from './adapters/stripe-gateway';
import { addDays, BillingCoreService, isoDate, money } from './billing-core.service';
import { billingInvoiceLines, billingInvoices, billingPayments, InvoiceRow, SubscriptionRow, subscriptions } from './billing.schema';

interface StripeJob {
  webhookEventId: string;
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : v && typeof v === 'object' && 'id' in v ? String((v as Obj).id) : null);
const cents = (v: unknown): number => (typeof v === 'number' ? v / 100 : 0);
const fromUnix = (v: unknown): Date | null => (typeof v === 'number' ? new Date(v * 1000) : null);

/**
 * POST /webhooks/stripe (API guide §10a): Stripe-Signature checked, event stored first (same event ID only once),
 * then processed by the worker with the platform role.
 */
@ApiTags('Webhooks (inbound)')
@Controller('webhooks/stripe')
@Public()
export class StripeWebhookController {
  constructor(
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
    private readonly platform: PlatformDbService,
    private readonly core: BillingCoreService,
    private readonly queue: QueueService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: 'receiveStripeBillingEvent', summary: 'Stripe billing webhook' })
  @ApiOkResponse({ type: WebhookAck })
  async receive(@Req() req: Request & { rawBody?: Buffer }): Promise<WebhookAck> {
    let event: StripeEvent;
    try {
      event = this.stripe.parseWebhook(req.rawBody ?? Buffer.alloc(0), req.header('stripe-signature') ?? '');
    } catch {
      throw Problems.unauthorized('Invalid Stripe-Signature.');
    }
    const object = event.data.object;
    const customer = str(object.customer);
    const sub = customer ? await this.core.subscriptionByStripe(customer) : undefined;
    const [stored] = await this.platform.db
      .insert(webhookEvents)
      .values({ tenantId: sub?.tenantId ?? null, provider: 'stripe', externalEventId: event.id, signatureValid: true, payload: event as unknown as Obj })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (stored) await this.queue.send<StripeJob>('stripe-events', { webhookEventId: stored.id });
    return { received: true };
  }
}

/** stripe-events job (architecture §5): card saved, invoice issued / paid, payment failed, subscription updated or ended. */
@Injectable()
export class StripeEventProcessor implements OnModuleInit {
  private readonly logger = new Logger(StripeEventProcessor.name);

  constructor(
    private readonly platform: PlatformDbService,
    private readonly db: DbService,
    private readonly core: BillingCoreService,
    private readonly organization: OrganizationService,
    private readonly queue: QueueService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
  ) {}

  onModuleInit(): void {
    this.queue.register<StripeJob>('stripe-events', (job) => this.process(job.webhookEventId));
  }

  async process(webhookEventId: string): Promise<void> {
    const [row] = await this.platform.db.select().from(webhookEvents).where(eq(webhookEvents.id, webhookEventId)).limit(1);
    if (!row || row.status === 'processed') return;
    const event = row.payload as unknown as StripeEvent;
    try {
      await this.handle(event);
      await this.platform.db.update(webhookEvents).set({ status: 'processed', attempts: row.attempts + 1, processedAt: new Date(), lastError: null }).where(eq(webhookEvents.id, row.id));
    } catch (err) {
      await this.platform.db.update(webhookEvents).set({ status: 'failed', attempts: row.attempts + 1, lastError: (err as Error).message.slice(0, 1000) }).where(eq(webhookEvents.id, row.id));
      throw err;
    }
  }

  private async handle(event: StripeEvent): Promise<void> {
    const o = event.data.object;
    const sub = await this.core.subscriptionByStripe(str(o.customer), event.type.startsWith('customer.subscription') ? str(o.id) : str(o.subscription));
    if (!sub) {
      this.logger.warn(`Stripe ${event.type} ${event.id}: no matching subscription`);
      return;
    }
    switch (event.type) {
      case 'setup_intent.succeeded': {
        const pm = str(o.payment_method);
        if (pm) await this.stripe.setDefaultCard(str(o.customer)!, pm);
        if (!sub.cardOnFile) await this.core.update(sub, { cardOnFile: true }, 'payment_method_changed', { type: 'stripe' }, 'Card saved');
        return;
      }
      case 'invoice.finalized':
        await this.mirror(sub, o);
        return;
      case 'invoice.paid':
        return this.paid(sub, o);
      case 'invoice.payment_failed':
        return this.failed(sub, o);
      case 'invoice.voided': {
        const invoice = await this.mirror(sub, o);
        if (invoice && invoice.status !== 'void') await this.platform.db.update(billingInvoices).set({ status: 'void', updatedAt: new Date() }).where(eq(billingInvoices.id, invoice.id));
        return;
      }
      case 'customer.subscription.updated': {
        const periodStart = fromUnix(o.current_period_start);
        const periodEnd = fromUnix(o.current_period_end);
        const cancel = o.cancel_at_period_end === true;
        if (periodEnd?.getTime() !== sub.currentPeriodEnd?.getTime() || cancel !== sub.cancelAtPeriodEnd) {
          await this.platform.db
            .update(subscriptions)
            .set({ currentPeriodStart: periodStart ?? sub.currentPeriodStart, currentPeriodEnd: periodEnd ?? sub.currentPeriodEnd, cancelAtPeriodEnd: cancel, updatedAt: new Date() })
            .where(eq(subscriptions.id, sub.id));
        }
        return;
      }
      case 'customer.subscription.deleted': {
        if (sub.status === 'canceled') return;
        const settings = await this.core.settings();
        const now = new Date();
        await this.core.setStatus(sub, 'canceled', { canceledAt: now, cancelAtPeriodEnd: false, dataDeleteAfter: isoDate(addDays(now, settings.retentionDays)) }, 'canceled', { type: 'stripe' });
        await this.core.tellAdmins(sub.tenantId, 'billing_canceled', 'Your subscription has ended', `Your data stays available for export for ${settings.retentionDays} days, then it is deleted.`);
        return;
      }
      default:
        this.logger.debug(`Stripe ${event.type} ignored`);
    }
  }

  /** Our UAE tax invoice for a Stripe invoice (created once; zero-amount invoices, e.g. at trial start, are skipped). */
  async mirror(sub: SubscriptionRow, o: Obj): Promise<InvoiceRow | undefined> {
    const stripeId = str(o.id)!;
    const [existing] = await this.platform.db.select().from(billingInvoices).where(eq(billingInvoices.stripeInvoiceId, stripeId)).limit(1);
    if (existing) return existing;
    const subtotal = cents(o.subtotal);
    if (subtotal <= 0 && cents(o.total) <= 0) return undefined;
    const lines = ((o.lines as Obj | undefined)?.data as Obj[] | undefined) ?? [];
    const periods = lines.map((l) => l.period as Obj | undefined).filter(Boolean) as Obj[];
    const start = periods.length ? new Date(Math.min(...periods.map((p) => Number(p.start) * 1000))) : (fromUnix(o.period_start) ?? new Date());
    const end = periods.length ? new Date(Math.max(...periods.map((p) => Number(p.end) * 1000))) : (fromUnix(o.period_end) ?? start);
    const issued = fromUnix(o.created) ?? new Date();
    const due = fromUnix(o.due_date) ?? issued;
    const tenant = await this.db.withTenant(sub.tenantId, () => this.organization.getProfile(sub.tenantId));
    const settings = await this.core.settings();
    return this.platform.transaction(async () => {
      const [invoice] = await this.platform.db
        .insert(billingInvoices)
        .values({
          tenantId: sub.tenantId,
          subscriptionId: sub.id,
          number: await this.core.nextInvoiceNumber(),
          status: 'open',
          periodStart: isoDate(start),
          periodEnd: isoDate(end < start ? start : end),
          issueDate: isoDate(issued),
          dueDate: isoDate(due < issued ? issued : due),
          currency: String(o.currency ?? 'aed').toUpperCase(),
          subtotal: money(subtotal),
          vatRate: money(settings.vatRate),
          vatAmount: money(Math.max(0, cents(o.total) - subtotal)),
          customerLegalName: tenant.legalName ?? tenant.name,
          customerTrn: tenant.trn ?? null,
          customerAddress: tenant.address ?? null,
          stripeInvoiceId: stripeId,
        })
        .returning();
      let n = 1;
      for (const l of lines) {
        const amount = cents(l.amount);
        if (amount === 0) continue;
        const quantity = Math.max(1, Number(l.quantity ?? 1));
        const type = amount < 0 ? 'credit' : l.proration ? 'extra_seats' : 'subscription';
        await this.platform.db.insert(billingInvoiceLines).values({
          tenantId: sub.tenantId,
          invoiceId: invoice!.id,
          lineNo: n++,
          type,
          description: String(l.description ?? 'Subscription'),
          quantity,
          unitPrice: money(amount / quantity),
          amount: money(amount),
        });
      }
      return invoice!;
    });
  }

  private async paid(sub: SubscriptionRow, o: Obj): Promise<void> {
    const invoice = await this.mirror(sub, o);
    if (invoice && invoice.status !== 'paid') {
      const balance = Number(invoice.balance);
      if (!o.paid_out_of_band && balance > 0) {
        await this.platform.db.insert(billingPayments).values({
          tenantId: sub.tenantId,
          invoiceId: invoice.id,
          method: 'card',
          status: 'succeeded',
          amount: money(balance),
          currency: invoice.currency,
          stripePaymentIntentId: str(o.payment_intent) ?? `pi_unknown_${str(o.id)}`,
          receivedAt: new Date(),
        })
        // A retried card payment keeps its payment intent: the earlier failed attempt becomes the success.
        .onConflictDoUpdate({ target: billingPayments.stripePaymentIntentId, set: { status: 'succeeded', amount: money(balance), receivedAt: new Date(), failureReason: null, updatedAt: new Date() } });
        await this.core.applyPayment(invoice, balance, new Date());
      } else if (balance > 0) {
        await this.core.applyPayment(invoice, balance, new Date());
      }
    }
    const fresh = (await this.core.subscriptionOf(sub.tenantId))!;
    if (fresh.status === 'trialing' && cents(o.amount_paid) > 0) await this.core.setStatus(fresh, 'active', {}, 'activated', { type: 'stripe' });
    else await this.core.reactivateIfUnpaid(fresh, { type: 'stripe' });
  }

  /** Payment failed (SRS §12): email and banner, 14 days of grace with everything working, then read-only. */
  private async failed(sub: SubscriptionRow, o: Obj): Promise<void> {
    const invoice = await this.mirror(sub, o);
    if (invoice && str(o.payment_intent)) {
      await this.platform.db
        .insert(billingPayments)
        .values({
          tenantId: sub.tenantId,
          invoiceId: invoice.id,
          method: 'card',
          status: 'failed',
          amount: money(Math.max(0.01, Number(invoice.balance))),
          currency: invoice.currency,
          stripePaymentIntentId: str(o.payment_intent)!,
          failureReason: String(((o.last_finalization_error as Obj | undefined)?.message as string | undefined) ?? 'The card payment was declined'),
        })
        .onConflictDoNothing();
    }
    if (sub.status !== 'active' && sub.status !== 'trialing') return;
    const settings = await this.core.settings();
    const graceEndsAt = addDays(new Date(), settings.graceDays);
    const after = await this.core.setStatus(sub, 'past_due', { graceEndsAt }, 'payment_failed', { type: 'stripe' });
    await this.core.event(this.platform.db, after, 'grace_started', { type: 'system' }, null, { graceEndsAt: graceEndsAt.toISOString() });
    await this.core.tellAdmins(
      sub.tenantId,
      'billing_payment_failed',
      'Payment failed, please update your card or pay by transfer.',
      `Everything keeps working until ${isoDate(graceEndsAt)}. After that the account becomes read-only until it is paid.`,
    );
  }
}
