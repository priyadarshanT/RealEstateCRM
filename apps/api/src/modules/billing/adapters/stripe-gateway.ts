import Stripe from 'stripe';

/** What we need from Stripe (architecture: one adapter per provider). Card details never reach our servers. */
export interface StripeGateway {
  createCustomer(input: { email: string; name: string; metadata: Record<string, string> }): Promise<string>;
  /** A card setup for Stripe Elements in the browser. */
  createSetupIntent(customerId: string): Promise<{ id: string; clientSecret: string }>;
  getSetupIntent(id: string): Promise<{ status: string; customerId: string | null; paymentMethodId: string | null }>;
  setDefaultCard(customerId: string, paymentMethodId: string): Promise<void>;
  cardLast4(customerId: string): Promise<string | null>;
  createSubscription(input: {
    customerId: string;
    seats: number;
    unitAmount: string;
    currency: string;
    interval: 'month' | 'year';
    productName: string;
    trialEnd?: Date;
    collection: 'charge_automatically' | 'send_invoice';
    metadata: Record<string, string>;
  }): Promise<{ id: string; currentPeriodStart: Date; currentPeriodEnd: Date }>;
  /** Seats, price or cycle; more seats or an upgrade are charged pro-rata now. */
  updateSubscription(
    id: string,
    change: { seats?: number; unitAmount?: string; currency?: string; interval?: 'month' | 'year'; productName?: string; prorate: boolean; collection?: 'charge_automatically' | 'send_invoice' },
  ): Promise<void>;
  setCancelAtPeriodEnd(id: string, cancel: boolean): Promise<void>;
  /** Free extra days for a trial (owner console). */
  setTrialEnd(id: string, trialEnd: Date): Promise<void>;
  /** Mark a Stripe invoice paid outside Stripe (bank transfer confirmed by our team). */
  payInvoiceOutOfBand(invoiceId: string): Promise<void>;
  voidInvoice(invoiceId: string): Promise<void>;
  /** Checks Stripe-Signature and returns the event. */
  parseWebhook(rawBody: Buffer, signature: string): StripeEvent;
}
export const STRIPE_GATEWAY = Symbol('STRIPE_GATEWAY');

/** The subset of a Stripe event we read. */
export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

const VAT_RATE_CACHE = new Map<string, string>();

export class StripeSdkGateway implements StripeGateway {
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string | undefined,
  ) {
    this.stripe = new Stripe(secretKey);
  }

  async createCustomer(input: { email: string; name: string; metadata: Record<string, string> }) {
    return (await this.stripe.customers.create(input)).id;
  }

  async createSetupIntent(customerId: string) {
    const intent = await this.stripe.setupIntents.create({ customer: customerId, usage: 'off_session', payment_method_types: ['card'] });
    return { id: intent.id, clientSecret: intent.client_secret! };
  }

  async getSetupIntent(id: string) {
    const intent = await this.stripe.setupIntents.retrieve(id);
    return {
      status: intent.status,
      customerId: typeof intent.customer === 'string' ? intent.customer : (intent.customer?.id ?? null),
      paymentMethodId: typeof intent.payment_method === 'string' ? intent.payment_method : (intent.payment_method?.id ?? null),
    };
  }

  async setDefaultCard(customerId: string, paymentMethodId: string) {
    await this.stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
  }

  async cardLast4(customerId: string) {
    const customer = await this.stripe.customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method'] });
    if (customer.deleted) return null;
    const pm = customer.invoice_settings.default_payment_method;
    return pm && typeof pm !== 'string' ? (pm.card?.last4 ?? null) : null;
  }

  async createSubscription(input: Parameters<StripeGateway['createSubscription']>[0]) {
    const sub = await this.stripe.subscriptions.create({
      customer: input.customerId,
      items: [{ quantity: input.seats, price_data: await this.priceData(input) }],
      trial_end: input.trialEnd ? Math.floor(input.trialEnd.getTime() / 1000) : undefined,
      collection_method: input.collection,
      ...(input.collection === 'send_invoice' ? { days_until_due: 14 } : {}),
      default_tax_rates: [await this.vatRate()],
      metadata: input.metadata,
    });
    return { id: sub.id, currentPeriodStart: new Date(sub.current_period_start * 1000), currentPeriodEnd: new Date(sub.current_period_end * 1000) };
  }

  async updateSubscription(id: string, change: Parameters<StripeGateway['updateSubscription']>[1]) {
    const sub = await this.stripe.subscriptions.retrieve(id);
    const item = sub.items.data[0]!;
    const price = item.price;
    const priceChanged = change.unitAmount !== undefined || change.interval !== undefined;
    await this.stripe.subscriptions.update(id, {
      items: [
        {
          id: item.id,
          ...(change.seats !== undefined ? { quantity: change.seats } : {}),
          ...(priceChanged
            ? {
                price_data: await this.priceData({
                  unitAmount: change.unitAmount ?? (price.unit_amount! / 100).toFixed(2),
                  currency: change.currency ?? price.currency.toUpperCase(),
                  interval: change.interval ?? (price.recurring!.interval as 'month' | 'year'),
                  productName: change.productName ?? 'CRM subscription',
                }),
              }
            : {}),
        },
      ],
      proration_behavior: change.prorate ? 'always_invoice' : 'none',
      ...(change.collection ? { collection_method: change.collection, ...(change.collection === 'send_invoice' ? { days_until_due: 14 } : {}) } : {}),
    });
  }

  async setCancelAtPeriodEnd(id: string, cancel: boolean) {
    await this.stripe.subscriptions.update(id, { cancel_at_period_end: cancel });
  }

  async setTrialEnd(id: string, trialEnd: Date) {
    await this.stripe.subscriptions.update(id, { trial_end: Math.floor(trialEnd.getTime() / 1000), proration_behavior: 'none' });
  }

  async payInvoiceOutOfBand(invoiceId: string) {
    await this.stripe.invoices.pay(invoiceId, { paid_out_of_band: true });
  }

  async voidInvoice(invoiceId: string) {
    await this.stripe.invoices.voidInvoice(invoiceId);
  }

  parseWebhook(rawBody: Buffer, signature: string): StripeEvent {
    if (!this.webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret) as unknown as StripeEvent;
  }

  private async priceData(p: { unitAmount: string; currency: string; interval: 'month' | 'year'; productName: string }) {
    const product = await this.stripe.products.create({ name: p.productName });
    return { currency: p.currency.toLowerCase(), product: product.id, unit_amount: Math.round(Number(p.unitAmount) * 100), recurring: { interval: p.interval } };
  }

  /** UAE VAT 5%, exclusive (prices exclude VAT; SRS §12). */
  private async vatRate(): Promise<string> {
    const cached = VAT_RATE_CACHE.get('ae');
    if (cached) return cached;
    const existing = (await this.stripe.taxRates.list({ active: true, limit: 100 })).data.find((r) => r.percentage === 5 && !r.inclusive && r.country === 'AE');
    const rate = existing ?? (await this.stripe.taxRates.create({ display_name: 'VAT', percentage: 5, inclusive: false, country: 'AE', jurisdiction: 'United Arab Emirates' }));
    VAT_RATE_CACHE.set('ae', rate.id);
    return rate.id;
  }
}

/**
 * Used while Stripe keys are not set (they are added later: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET). The API starts
 * normally; only calls that need Stripe fail, with a clear message.
 */
export function unconfiguredStripe(): StripeGateway {
  const missing = async (): Promise<never> => {
    throw new Error('Stripe is not configured: set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET');
  };
  return {
    createCustomer: missing,
    createSetupIntent: missing,
    getSetupIntent: missing,
    setDefaultCard: missing,
    cardLast4: async () => null,
    createSubscription: missing,
    updateSubscription: missing,
    setCancelAtPeriodEnd: missing,
    setTrialEnd: missing,
    payInvoiceOutOfBand: missing,
    voidInvoice: missing,
    parseWebhook: () => {
      throw new Error('Stripe is not configured: set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET');
    },
  };
}
