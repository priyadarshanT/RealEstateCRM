import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq, gt, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { DbService } from '../../core/database/db.service';
import { PlatformDbService } from '../../core/database/platform-db.service';
import { WorkerDbService } from '../../core/database/worker-db.service';
import { FilesService } from '../../core/files/files.service';
import { QueueService } from '../../core/queue/queue.service';
import { LeadsService } from '../leads/leads.service';
import { OrganizationDirectory } from '../organization/directory.service';
import { PDF_RENDERER, PdfRenderer } from './adapters/services';
import { STRIPE_GATEWAY, StripeGateway } from './adapters/stripe-gateway';
import { addDays, BillingCoreService, isoDate } from './billing-core.service';
import { billingInvoices, subscriptions, tenantUsageDaily } from './billing.schema';
import { invoiceHtml } from './invoice-html';

/**
 * Billing background jobs (architecture §5):
 * - billing-dunning (hourly): unpaid after the grace period → read-only; trial-ending reminders; changes scheduled
 *   for the renewal (fewer seats, downgrade, monthly) applied just before it; overdue bank-transfer invoices → grace;
 * - billing-invoices (daily): stores the PDF of every tax invoice;
 * - tenant-usage (nightly): daily usage per company for the owner console;
 * - tenant-data-deletion (nightly): a cancelled company's data is deleted 90 days after the end.
 */
@Injectable()
export class BillingJobs implements OnModuleInit {
  private readonly logger = new Logger(BillingJobs.name);

  constructor(
    private readonly queue: QueueService,
    private readonly platform: PlatformDbService,
    private readonly workerDb: WorkerDbService,
    private readonly db: DbService,
    private readonly core: BillingCoreService,
    private readonly files: FilesService,
    private readonly leads: LeadsService,
    private readonly directory: OrganizationDirectory,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
    @Inject(PDF_RENDERER) private readonly pdf: PdfRenderer,
  ) {}

  onModuleInit(): void {
    this.queue.register('billing-dunning', () => this.dunning(), { cron: '5 * * * *' });
    this.queue.register('billing-invoices', () => this.invoicePdfs(), { cron: '30 2 * * *' });
    this.queue.register('tenant-usage', () => this.usage(), { cron: '15 1 * * *' });
    this.queue.register('tenant-data-deletion', async () => void (await this.dataDeletion()), { cron: '45 3 * * *' });
  }

  async dunning(now = new Date()): Promise<void> {
    // Grace over → read-only (changes return 402; reading and export keep working; new leads are still saved).
    const overdue = await this.platform.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.status, 'past_due'), isNotNull(subscriptions.graceEndsAt), lte(subscriptions.graceEndsAt, now)));
    for (const sub of overdue) {
      await this.core.setStatus(sub, 'read_only', {}, 'read_only', { type: 'system' });
      await this.core.tellAdmins(sub.tenantId, 'billing_read_only', 'Your account is read-only until payment', 'You can still view and export your data. Paying reactivates the account at once.');
    }

    // Trial ends within 3 days: one reminder (this hour's window).
    const reminders = await this.platform.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.status, 'trialing'), gt(subscriptions.trialEndsAt, new Date(now.getTime() + 71 * 3_600_000)), lte(subscriptions.trialEndsAt, new Date(now.getTime() + 72 * 3_600_000))));
    for (const sub of reminders) {
      await this.core.tellAdmins(sub.tenantId, 'billing_trial_ending', 'Your free trial ends in 3 days', `Your card will be charged on ${isoDate(sub.trialEndsAt!)} unless you cancel.`);
    }

    // Scheduled changes, applied in the hour before the renewal.
    const renewing = await this.platform.db
      .select()
      .from(subscriptions)
      .where(
        and(
          or(isNotNull(subscriptions.scheduledSeats), isNotNull(subscriptions.scheduledPlanId), isNotNull(subscriptions.scheduledBillingCycle)),
          lte(subscriptions.currentPeriodEnd, new Date(now.getTime() + 3_600_000)),
        ),
      );
    for (const sub of renewing) {
      const plan = await this.core.plan(sub.scheduledPlanId ?? sub.planId);
      const cycle = sub.scheduledBillingCycle ?? sub.billingCycle;
      const seats = Math.max(sub.scheduledSeats ?? sub.seats, await this.core.seatsUsed(sub.tenantId));
      const price = BillingCoreService.price(plan, cycle);
      if (sub.stripeSubscriptionId) {
        await this.stripe.updateSubscription(sub.stripeSubscriptionId, { seats, unitAmount: price, currency: plan.currency, interval: cycle === 'yearly' ? 'year' : 'month', productName: `${plan.name} plan`, prorate: false });
      }
      await this.core.update(
        sub,
        { seats, planId: plan.id, billingCycle: cycle, pricePerSeat: price, scheduledSeats: null, scheduledPlanId: null, scheduledBillingCycle: null },
        sub.scheduledSeats !== null ? 'seats_changed' : sub.scheduledPlanId !== null ? 'plan_changed' : 'cycle_changed',
        { type: 'system' },
        'Scheduled change applied at renewal',
      );
    }

    // Bank transfer: an invoice unpaid after its due date starts the grace period.
    const late = await this.platform.db
      .select({ sub: subscriptions })
      .from(billingInvoices)
      .innerJoin(subscriptions, eq(subscriptions.id, billingInvoices.subscriptionId))
      .where(and(eq(billingInvoices.status, 'open'), lt(billingInvoices.dueDate, isoDate(now)), eq(subscriptions.status, 'active'), eq(subscriptions.paymentMethod, 'bank_transfer')));
    const settings = await this.core.settings();
    for (const { sub } of late) {
      const fresh = (await this.core.subscriptionOf(sub.tenantId))!;
      if (fresh.status !== 'active') continue;
      const graceEndsAt = addDays(now, settings.graceDays);
      await this.core.setStatus(fresh, 'past_due', { graceEndsAt }, 'payment_failed', { type: 'system' }, 'Invoice unpaid after its due date');
      await this.core.tellAdmins(sub.tenantId, 'billing_payment_failed', 'Payment overdue: please pay the open invoice', `Everything keeps working until ${isoDate(graceEndsAt)}.`);
    }
  }

  async invoicePdfs(): Promise<void> {
    const missing = await this.platform.db.select().from(billingInvoices).where(isNull(billingInvoices.pdfFileId)).limit(200);
    for (const invoice of missing) {
      try {
        const lines = (await this.core.invoiceLines([invoice.id])).get(invoice.id) ?? [];
        const body = await this.pdf.render(invoiceHtml(invoice, lines));
        const file = await this.db.withTenant(invoice.tenantId, () => this.files.store(`${invoice.number}.pdf`, 'application/pdf', body, 'billing'));
        await this.platform.db.update(billingInvoices).set({ pdfFileId: file.id }).where(eq(billingInvoices.id, invoice.id));
      } catch (err) {
        this.logger.warn(`invoice ${invoice.number}: PDF not made (${(err as Error).message})`);
      }
    }
  }

  /** Yesterday's usage per company: active users, new leads, messages (Phase 2), storage. */
  async usage(now = new Date()): Promise<void> {
    const day = isoDate(addDays(now, -1));
    const [leadCounts, storage] = await Promise.all([this.leads.createdPerTenant(day), this.files.storagePerTenant()]);
    const tenants = await this.platform.db.select({ tenantId: subscriptions.tenantId }).from(subscriptions);
    for (const { tenantId } of tenants) {
      const active = (await this.db.withTenant(tenantId, () => this.directory.userCounts())).active;
      const values = { activeUsers: active, leadsCreated: leadCounts.get(tenantId) ?? 0, messagesSent: 0, storageBytes: storage.get(tenantId) ?? 0 };
      await this.platform.db
        .insert(tenantUsageDaily)
        .values({ tenantId, day, ...values })
        .onConflictDoUpdate({ target: [tenantUsageDaily.tenantId, tenantUsageDaily.day], set: values });
    }
  }

  /** SRS §12: after the end, data can be exported for 90 days, then it is deleted permanently. */
  async dataDeletion(): Promise<string[]> {
    // The database date, exactly as delete_tenant_data() checks it.
    const due = await this.platform.db
      .select({ tenantId: subscriptions.tenantId })
      .from(subscriptions)
      .where(and(eq(subscriptions.status, 'canceled'), sql`${subscriptions.dataDeleteAfter} < current_date`));
    for (const { tenantId } of due) {
      await this.workerDb.db.execute(sql`SELECT delete_tenant_data(${tenantId}::uuid)`);
      this.logger.log(`tenant ${tenantId}: data deleted (90 days after cancellation)`);
    }
    return due.map((d) => d.tenantId);
  }
}

