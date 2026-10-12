import { randomUUID } from 'node:crypto';
import { StripeEvent, StripeGateway } from '../src/modules/billing/adapters/stripe-gateway';

/** In-memory Stripe for tests: customers, card setups, subscriptions; signed webhooks are plain JSON with a test signature. */
export class FakeStripe implements StripeGateway {
  static readonly SIGNATURE = 't=1,v1=test-signature';
  readonly customers = new Map<string, { email: string; card?: string }>();
  readonly setupIntents = new Map<string, { customerId: string; status: string; paymentMethodId: string | null }>();
  readonly subscriptions = new Map<string, { customerId: string; seats: number; unitAmount: string; interval: 'month' | 'year'; cancelAtPeriodEnd: boolean; trialEnd?: Date; collection: string }>();
  readonly calls: string[] = [];

  async createCustomer(input: { email: string }) {
    const id = `cus_${randomUUID().slice(0, 8)}`;
    this.customers.set(id, { email: input.email });
    return id;
  }

  async createSetupIntent(customerId: string) {
    const id = `seti_${randomUUID().slice(0, 8)}`;
    this.setupIntents.set(id, { customerId, status: 'requires_payment_method', paymentMethodId: null });
    return { id, clientSecret: `${id}_secret` };
  }

  /** What the browser does with Stripe Elements: the card is saved. */
  confirmCard(setupIntentId: string) {
    const intent = this.setupIntents.get(setupIntentId)!;
    intent.status = 'succeeded';
    intent.paymentMethodId = `pm_${randomUUID().slice(0, 8)}`;
  }

  async getSetupIntent(id: string) {
    const intent = this.setupIntents.get(id);
    if (!intent) throw new Error('No such setup intent');
    return { status: intent.status, customerId: intent.customerId, paymentMethodId: intent.paymentMethodId };
  }

  async setDefaultCard(customerId: string) {
    this.customers.get(customerId)!.card = '4242';
  }

  async cardLast4(customerId: string) {
    return this.customers.get(customerId)?.card ?? null;
  }

  async createSubscription(input: Parameters<StripeGateway['createSubscription']>[0]) {
    const id = `sub_${randomUUID().slice(0, 8)}`;
    this.subscriptions.set(id, { customerId: input.customerId, seats: input.seats, unitAmount: input.unitAmount, interval: input.interval, cancelAtPeriodEnd: false, trialEnd: input.trialEnd, collection: input.collection });
    const now = new Date();
    return { id, currentPeriodStart: now, currentPeriodEnd: input.trialEnd ?? new Date(now.getTime() + 30 * 86_400_000) };
  }

  async updateSubscription(id: string, change: Parameters<StripeGateway['updateSubscription']>[1]) {
    const sub = this.subscriptions.get(id)!;
    if (change.seats !== undefined) sub.seats = change.seats;
    if (change.unitAmount !== undefined) sub.unitAmount = change.unitAmount;
    if (change.interval !== undefined) sub.interval = change.interval;
    if (change.collection) sub.collection = change.collection;
    this.calls.push(`update ${id} ${JSON.stringify(change)}`);
  }

  async setCancelAtPeriodEnd(id: string, cancel: boolean) {
    this.subscriptions.get(id)!.cancelAtPeriodEnd = cancel;
  }

  async setTrialEnd(id: string, trialEnd: Date) {
    this.subscriptions.get(id)!.trialEnd = trialEnd;
  }

  async payInvoiceOutOfBand(invoiceId: string) {
    this.calls.push(`paid_out_of_band ${invoiceId}`);
  }

  async voidInvoice(invoiceId: string) {
    this.calls.push(`void ${invoiceId}`);
  }

  parseWebhook(rawBody: Buffer, signature: string): StripeEvent {
    if (signature !== FakeStripe.SIGNATURE) throw new Error('bad signature');
    return JSON.parse(rawBody.toString('utf8')) as StripeEvent;
  }

  /** A Stripe invoice event body for a subscription. */
  invoiceEvent(type: string, input: { customerId: string; subscriptionId: string; seats: number; unitAmount: string; invoiceId?: string; proration?: boolean; paymentIntent?: string }): StripeEvent {
    const now = Math.floor(Date.now() / 1000);
    const subtotal = Math.round(input.seats * Number(input.unitAmount) * 100);
    const tax = Math.round(subtotal * 0.05);
    return {
      id: `evt_${randomUUID().slice(0, 8)}`,
      type,
      data: {
        object: {
          id: input.invoiceId ?? `in_${randomUUID().slice(0, 8)}`,
          object: 'invoice',
          customer: input.customerId,
          subscription: input.subscriptionId,
          currency: 'aed',
          subtotal,
          total: subtotal + tax,
          amount_paid: type === 'invoice.paid' ? subtotal + tax : 0,
          created: now,
          due_date: now + 14 * 86_400,
          payment_intent: input.paymentIntent ?? `pi_${randomUUID().slice(0, 8)}`,
          lines: {
            data: [
              { description: `${input.seats} × Team plan`, quantity: input.seats, amount: subtotal, proration: input.proration ?? false, period: { start: now, end: now + 30 * 86_400 } },
            ],
          },
        },
      },
    };
  }
}
