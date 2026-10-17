import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signDevPlatformToken } from '../src/core/auth/platform-auth';
import { loadConfig } from '../src/core/config/app-config';
import { MAILER, MemoryMailer } from '../src/core/mail/mailer';
import { QueueService } from '../src/core/queue/queue.service';
import { PDF_RENDERER } from '../src/modules/billing/adapters/services';
import { STRIPE_GATEWAY } from '../src/modules/billing/adapters/stripe-gateway';
import { BillingJobs } from '../src/modules/billing/billing-jobs';
import { FakeStripe } from './fake-stripe';
import { createTestApp, ownerQuery, signIn, testStorage, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

// Subscriptions, billing, sign-up and the owner console (SRS §12; acceptance tests 14–19).
describe('sign-up, billing, owner console', () => {
  let app: INestApplication;
  const stripe = new FakeStripe();
  const mail = new MemoryMailer();
  let server: ReturnType<INestApplication['getHttpServer']>;
  let owner: (method: 'get' | 'post' | 'patch' | 'put', url: string) => request.Test;
  let tenantId: string;
  let admin: Client;
  let sub: { customerId: string; subscriptionId: string };
  const signupBody = (extra: Record<string, unknown> = {}) => ({
    tenantType: 'brokerage',
    companyName: 'Palm Homes Real Estate',
    tradeLicenseNo: 'TL-7788',
    reraOrn: 'ORN-7788',
    adminFullName: 'Huda Saleh',
    adminEmail: 'huda@palmhomes.ae',
    adminPhone: '+971501112299',
    planKey: 'team',
    seats: 3,
    billingCycle: 'monthly',
    acceptTerms: true,
    turnstileToken: 'ok',
    ...extra,
  });
  const webhook = (event: object) =>
    request(server).post('/api/v1/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', FakeStripe.SIGNATURE).send(JSON.stringify(event));
  const drainStripe = () => app.get(QueueService).drain('stripe-events');
  const codeFor = (email: string) => /(\d{6}) is your confirmation code/.exec(mail.last(email)!.subject)![1]!;

  beforeAll(async () => {
    app = await createTestApp((b) =>
      b
        .overrideProvider(STRIPE_GATEWAY)
        .useValue(stripe)
        .overrideProvider(MAILER)
        .useValue(mail)
        .overrideProvider(PDF_RENDERER)
        .useValue({ render: async (html: string) => Buffer.from(`%PDF-fake ${html.length}`) }),
    );
    server = app.getHttpServer();
    const token = await signDevPlatformToken(loadConfig().DEV_AUTH_SECRET!, { sub: 'platform|owner', email: 'owner@crm.ae' });
    owner = (method, url) => request(server)[method](url).set('Authorization', `Bearer ${token}`);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('sign-up with a 14-day trial (acceptance test 14)', () => {
    it('shows the plans and refuses what the rules do not allow', async () => {
      const plans = await request(server).get('/api/v1/public/plans').expect(200);
      expect(plans.body.data.map((p: { key: string; priceMonthly: string }) => [p.key, p.priceMonthly])).toEqual([
        ['solo', '99.00'],
        ['team', '99.00'],
        ['enterprise', '99.00'],
      ]);
      const codes = async (body: object) => (await request(server).post('/api/v1/public/signup').send(body)).body.code;
      expect(await codes(signupBody({ planKey: 'enterprise' }))).toBe('PLAN_NOT_SELF_SERVICE');
      expect(await codes(signupBody({ reraOrn: undefined }))).toBe('LICENCE_REQUIRED');
      expect(await codes(signupBody({ planKey: 'solo' }))).toBe('PLAN_NOT_ALLOWED');
      expect(await codes(signupBody({ tenantType: 'individual', planKey: 'solo', reraBrn: undefined }))).toBe('LICENCE_REQUIRED');
      expect(await codes(signupBody({ adminEmail: 'admin@a.ae' }))).toBe('EMAIL_ALREADY_REGISTERED');
      expect(await codes(signupBody({ turnstileToken: 'fail' }))).toBe('BOT_CHECK_FAILED');
      await request(server).post('/api/v1/public/signup').send(signupBody({ acceptTerms: false })).expect(400);
    });

    it('email code → card → company with Admin, default roles and a trialing subscription', async () => {
      const start = await request(server).post('/api/v1/public/signup').send(signupBody()).expect(201);
      expect(start.body).toMatchObject({ emailVerified: false, cardSetup: { stripePublishableKey: expect.any(String), setupIntentClientSecret: expect.stringContaining('_secret') } });
      const id = start.body.signupId;
      const setupIntentId = start.body.cardSetup.setupIntentClientSecret.replace('_secret', '');

      await request(server).post(`/api/v1/public/signup/${id}/resend-code`).expect(429);
      expect((await request(server).post(`/api/v1/public/signup/${id}/complete`).send({ setupIntentId }).expect(422)).body.code).toBe('EMAIL_NOT_VERIFIED');
      const wrong = await request(server).post(`/api/v1/public/signup/${id}/verify-email`).send({ code: codeFor('huda@palmhomes.ae') === '000000' ? '111111' : '000000' }).expect(422);
      expect(wrong.body.code).toBe('CODE_INVALID');
      const verified = await request(server).post(`/api/v1/public/signup/${id}/verify-email`).send({ code: codeFor('huda@palmhomes.ae') }).expect(200);
      expect(verified.body.emailVerified).toBe(true);

      expect((await request(server).post(`/api/v1/public/signup/${id}/complete`).send({ setupIntentId }).expect(422)).body.code).toBe('CARD_REQUIRED');
      stripe.confirmCard(setupIntentId);
      const done = await request(server).post(`/api/v1/public/signup/${id}/complete`).send({ setupIntentId }).expect(201);
      tenantId = done.body.tenantId;
      const days = (new Date(done.body.trialEndsAt).getTime() - Date.now()) / 86_400_000;
      expect(Math.round(days)).toBe(14);
      expect(done.body.loginUrl).toBe('http://localhost:3000/login');
      const again = await request(server).post(`/api/v1/public/signup/${id}/complete`).send({ setupIntentId }).expect(201);
      expect(again.body.tenantId).toBe(tenantId);
      expect(mail.last('huda@palmhomes.ae')!.subject).toMatch(/Welcome/);

      admin = await signIn(app, { email: 'huda@palmhomes.ae', tenant: tenantId });
      const me = await admin.get('/api/v1/me').expect(200);
      expect(me.body).toMatchObject({ user: { status: 'active' }, tenant: { name: 'Palm Homes Real Estate', verificationStatus: 'pending' }, dataScope: 'company' });
      expect(me.body.permissions).toEqual(expect.arrayContaining(['billing.manage', 'leads.export']));
      expect((await admin.get('/api/v1/lead-stages').expect(200)).body.data.length).toBe(4);

      const subscription = await admin.get('/api/v1/billing/subscription').expect(200);
      expect(subscription.body).toMatchObject({
        status: 'trialing',
        seats: 3,
        seatsUsed: 1,
        pricePerSeat: '99.00',
        paymentMethod: 'card',
        cardLast4: '4242',
        plan: { key: 'team' },
        nextInvoiceEstimate: { subtotal: '297.00', vat: '14.85', total: '311.85' },
      });
      const history = await admin.get('/api/v1/billing/history').expect(200);
      expect(history.body.data.map((e: { type: string }) => e.type)).toEqual(['trial_started']);
      const [row] = await ownerQuery<{ stripe_customer_id: string; stripe_subscription_id: string }>(`SELECT stripe_customer_id, stripe_subscription_id FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
      sub = { customerId: row!.stripe_customer_id, subscriptionId: row!.stripe_subscription_id };
    });
  });

  describe('seats and plan (acceptance test 15)', () => {
    it('more seats now (pro-rata at Stripe), fewer seats from the next renewal, never below the active users', async () => {
      const more = await admin.put('/api/v1/billing/subscription/seats').send({ seats: 5 }).expect(200);
      expect(more.body.seats).toBe(5);
      expect(stripe.subscriptions.get(sub.subscriptionId)!.seats).toBe(5);
      const fewer = await admin.put('/api/v1/billing/subscription/seats').send({ seats: 4 }).expect(200);
      expect(fewer.body).toMatchObject({ seats: 5, nextInvoiceEstimate: { subtotal: '396.00' } });
      await ownerQuery(`UPDATE users SET status = 'active' WHERE tenant_id = $1`, [tenantId]); // already 1 active
      const roles = await admin.get('/api/v1/roles').expect(200);
      const agentRole = roles.body.data.find((r: { key: string }) => r.key === 'sales_agent').id;
      for (const n of [1, 2]) {
        await admin.post('/api/v1/users').send({ email: `agent${n}@palmhomes.ae`, fullName: `Agent ${n}`, roleId: agentRole }).expect(201);
        await (await signIn(app, { email: `agent${n}@palmhomes.ae`, tenant: tenantId })).get('/api/v1/me').expect(200);
      }
      const below = await admin.put('/api/v1/billing/subscription/seats').send({ seats: 2 }).expect(422);
      expect(below.body.code).toBe('SEATS_BELOW_ACTIVE_USERS');
      await admin.post('/api/v1/billing/subscription/change-plan').send({ planId: (await request(server).get('/api/v1/public/plans')).body.data[0].id }).expect(422);
      const yearly = await admin.post('/api/v1/billing/subscription/change-plan').send({ planId: (await request(server).get('/api/v1/public/plans')).body.data[1].id, billingCycle: 'yearly' }).expect(200);
      expect(yearly.body).toMatchObject({ billingCycle: 'yearly', pricePerSeat: '990.00' });
      const agent = await signIn(app, { email: 'agent1@palmhomes.ae', tenant: tenantId });
      await agent.get('/api/v1/billing/subscription').expect(403);
    });
  });

  describe('payments, failure, grace, read-only (acceptance tests 16–18)', () => {
    it('a paid Stripe invoice becomes our tax invoice with 5% VAT; the trial turns active', async () => {
      await webhook(stripe.invoiceEvent('invoice.paid', { ...sub, seats: 5, unitAmount: '99.00', invoiceId: 'in_paid_1', paymentIntent: 'pi_1' })).expect(200);
      await webhook(stripe.invoiceEvent('invoice.paid', { ...sub, seats: 5, unitAmount: '99.00', invoiceId: 'in_paid_1' })).expect(200); // different event, same invoice
      await request(server).post('/api/v1/webhooks/stripe').set('Stripe-Signature', 'bad').send('{}').expect(401);
      await drainStripe();
      const invoices = await admin.get('/api/v1/billing/invoices').expect(200);
      expect(invoices.body.data).toHaveLength(1);
      expect(invoices.body.data[0]).toMatchObject({ number: expect.stringMatching(/^CRM-\d{4}-\d{6}$/), status: 'paid', subtotal: '495.00', vatRate: '5.00', vatAmount: '24.75', total: '519.75', balance: '0.00' });
      expect((await admin.get('/api/v1/billing/subscription').expect(200)).body.status).toBe('active');
      const pdf = await admin.get(`/api/v1/billing/invoices/${invoices.body.data[0].id}/pdf`).expect(200);
      expect((await testStorage.read(pdf.body.url.replace('memory://download/', ''))).toString()).toMatch(/^%PDF-fake/);
      const payments = await admin.get('/api/v1/billing/payments').expect(200);
      expect(payments.body.data[0]).toMatchObject({ method: 'card', status: 'succeeded', amount: '519.75' });
    });

    it('failed payment → 14 days grace with a banner; then read-only (402 on changes; reading, export and paying still work)', async () => {
      await webhook(stripe.invoiceEvent('invoice.payment_failed', { ...sub, seats: 5, unitAmount: '99.00', invoiceId: 'in_failed_2', paymentIntent: 'pi_2' })).expect(200);
      await drainStripe();
      const pastDue = await admin.get('/api/v1/billing/subscription').expect(200);
      expect(pastDue.body.status).toBe('past_due');
      expect(Math.round((new Date(pastDue.body.graceEndsAt).getTime() - Date.now()) / 86_400_000)).toBe(14);
      const banner = await admin.get('/api/v1/notifications?unread=true').expect(200);
      expect(banner.body.data.map((n: { title: string }) => n.title)).toContain('Payment failed, please update your card or pay by transfer.');
      expect(mail.last('huda@palmhomes.ae')!.subject).toBe('Payment failed, please update your card or pay by transfer.');
      const lead = { fullName: 'Grace lead', phonePrimary: '+971558880001', sourceId: (await admin.get('/api/v1/lead-sources')).body.data[0].id };
      await admin.post('/api/v1/leads').send(lead).expect(201);

      await app.get(BillingJobs).dunning(new Date(Date.now() + 15 * 86_400_000));
      expect((await admin.get('/api/v1/billing/subscription').expect(200)).body.status).toBe('read_only');
      const blocked = await admin.post('/api/v1/leads').send({ ...lead, phonePrimary: '+971558880002' }).expect(402);
      expect(blocked.body.code).toBe('SUBSCRIPTION_READ_ONLY');
      await admin.get('/api/v1/leads').expect(200);
      await admin.post('/api/v1/reports/funnel/exports').send({ format: 'csv' }).expect(202);
      await admin.post('/api/v1/billing/card-setup').expect(201);
    });

    it('bank transfer: the Admin reports it, our team confirms it, the invoice is paid and the company is active again', async () => {
      const [failed] = await ownerQuery<{ id: string }>(`SELECT id FROM billing_invoices WHERE stripe_invoice_id = 'in_failed_2'`);
      await admin.post(`/api/v1/billing/invoices/${failed!.id}/bank-transfers`).send({ amount: '9999.00', bankReference: 'FT-1' }).expect(422);
      const transfer = await admin.post(`/api/v1/billing/invoices/${failed!.id}/bank-transfers`).send({ amount: '519.75', bankReference: 'FT-778899' }).expect(201);
      expect(transfer.body).toMatchObject({ method: 'bank_transfer', status: 'pending' });

      const pending = await owner('get', '/api/v1/platform/bank-transfers').expect(200);
      expect(pending.body.data[0]).toMatchObject({ id: transfer.body.id, tenantName: 'Palm Homes Real Estate', invoiceNumber: expect.any(String) });
      await owner('post', `/api/v1/platform/billing-payments/${transfer.body.id}/confirm`).send({ receivedAt: new Date().toISOString() }).expect(200);
      await owner('post', `/api/v1/platform/billing-payments/${transfer.body.id}/confirm`).send({ receivedAt: new Date().toISOString() }).expect(409);
      expect(stripe.calls).toContain('paid_out_of_band in_failed_2');
      expect((await admin.get(`/api/v1/billing/invoices/${failed!.id}`).expect(200)).body).toMatchObject({ status: 'paid', balance: '0.00' });
      expect((await admin.get('/api/v1/billing/subscription').expect(200)).body).toMatchObject({ status: 'active', graceEndsAt: null });
      await admin.post('/api/v1/leads').send({ fullName: 'After payment', phonePrimary: '+971558880003', sourceId: (await admin.get('/api/v1/lead-sources')).body.data[0].id }).expect(201);
      const history = await admin.get('/api/v1/billing/history').expect(200);
      expect(history.body.data.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['activated', 'payment_failed', 'grace_started', 'read_only', 'reactivated']));
    });
  });

  describe('owner console', () => {
    it('own login only; roles limit what each person can do; every action is logged', async () => {
      await request(server).get('/api/v1/platform/me').expect(401);
      await admin.get('/api/v1/platform/me').expect(401); // a tenant token is not an owner-console login
      expect((await owner('get', '/api/v1/platform/me').expect(200)).body).toMatchObject({ email: 'owner@crm.ae', role: 'owner' });
      await ownerQuery(`INSERT INTO platform_admins (email, full_name, role) VALUES ('support@crm.ae', 'Support', 'support') ON CONFLICT DO NOTHING`);
      const supportToken = await signDevPlatformToken(loadConfig().DEV_AUTH_SECRET!, { sub: 'platform|support', email: 'support@crm.ae' });
      const support = (m: 'get' | 'post', url: string) => request(server)[m](url).set('Authorization', `Bearer ${supportToken}`);
      await support('get', `/api/v1/platform/tenants/${tenantId}`).expect(200);
      await support('post', `/api/v1/platform/tenants/${tenantId}/suspend`).send({ reason: 'test' }).expect(403);
      await support('get', '/api/v1/platform/bank-transfers').expect(403);
    });

    it('companies: licence check, suspend blocks every login, metrics', async () => {
      const list = await owner('get', '/api/v1/platform/tenants?q=palm').expect(200);
      expect(list.body.data[0]).toMatchObject({ id: tenantId, adminEmail: 'huda@palmhomes.ae', usage: { seatsUsed: 3 }, subscription: { status: 'active' } });
      const verified = await owner('post', `/api/v1/platform/tenants/${tenantId}/verify`).send({ result: 'verified' }).expect(200);
      expect(verified.body.verificationStatus).toBe('verified');

      await owner('post', `/api/v1/platform/tenants/${tenantId}/suspend`).send({ reason: 'Abuse report' }).expect(200);
      expect((await admin.get('/api/v1/me').expect(403)).body.code).toBe('TENANT_SUSPENDED');
      await owner('post', `/api/v1/platform/tenants/${tenantId}/unsuspend`).expect(200);
      await admin.get('/api/v1/me').expect(200);

      const metrics = await owner('get', '/api/v1/platform/metrics').expect(200);
      expect(metrics.body).toMatchObject({ payingTenants: expect.any(Number), paidSeats: expect.any(Number), mrr: expect.stringMatching(/^\d+\.\d{2}$/) });
      expect(Number(metrics.body.mrr)).toBeGreaterThan(0);

      const audit = await owner('get', `/api/v1/platform/audit-logs?tenantId=${tenantId}`).expect(200);
      expect(audit.body.data.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['tenant.verify', 'tenant.suspend', 'tenant.unsuspend', 'payment.confirm']));
    });

    it('plans, settings, custom Enterprise price, trial extension', async () => {
      await owner('post', '/api/v1/platform/plans').send({ key: 'team', name: 'Dup', priceMonthly: '1', priceYearly: '10' }).expect(409);
      const plan = await owner('post', '/api/v1/platform/plans').send({ key: 'agency', name: 'Agency', priceMonthly: '89', priceYearly: '890', tenantType: 'brokerage', minSeats: 5 }).expect(201);
      expect(plan.body).toMatchObject({ key: 'agency', priceMonthly: '89.00', minSeats: 5 });
      await owner('patch', `/api/v1/platform/plans/${plan.body.id}`).send({ isActive: false }).expect(200);
      expect((await request(server).get('/api/v1/public/plans')).body.data.map((p: { key: string }) => p.key)).not.toContain('agency');

      await owner('put', '/api/v1/platform/settings/billing.grace').send({ value: { days: 0.5, then: 'read_only' } }).expect(400);
      await owner('put', '/api/v1/platform/settings/billing.nothing').send({ value: {} }).expect(422);
      const grace = await owner('put', '/api/v1/platform/settings/billing.grace').send({ value: { days: 21, then: 'read_only' } }).expect(200);
      expect(grace.body.value).toEqual({ days: 21, then: 'read_only' });
      await owner('put', '/api/v1/platform/settings/billing.grace').send({ value: { days: 14, then: 'read_only' } }).expect(200);

      const [row] = await ownerQuery<{ id: string }>(`SELECT id FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
      const custom = await owner('patch', `/api/v1/platform/subscriptions/${row!.id}`).send({ pricePerSeat: '850.00', note: 'Enterprise deal' }).expect(200);
      expect(custom.body.pricePerSeat).toBe('850.00');
      await owner('post', `/api/v1/platform/tenants/${tenantId}/extend`).send({ days: 10, note: 'Pilot' }).expect(422); // active: nothing to extend
    });

    it('sales enquiry → Enterprise company with the agreed price and an invited Admin', async () => {
      await request(server).post('/api/v1/public/sales-enquiries').send({ companyName: 'Big Brokers', contactName: 'Omar', email: 'omar@bigbrokers.ae', usersEstimate: 120, turnstileToken: 'ok' }).expect(201);
      const enquiries = await owner('get', '/api/v1/platform/sales-enquiries?status=new').expect(200);
      const enquiry = enquiries.body.data.find((e: { email: string }) => e.email === 'omar@bigbrokers.ae');
      await owner('patch', `/api/v1/platform/sales-enquiries/${enquiry.id}`).send({ status: 'contacted' }).expect(200);
      const created = await owner('post', `/api/v1/platform/sales-enquiries/${enquiry.id}/create-company`)
        .send({ tenantType: 'brokerage', companyName: 'Big Brokers LLC', tradeLicenseNo: 'TL-1', reraOrn: 'ORN-1', adminEmail: 'omar@bigbrokers.ae', adminFullName: 'Omar', seats: 120, pricePerSeat: '75.00', billingCycle: 'yearly', paymentMethod: 'bank_transfer' })
        .expect(201);
      expect(created.body.subscription).toMatchObject({ plan: { key: 'enterprise' }, seats: 120, pricePerSeat: '75.00', paymentMethod: 'bank_transfer', status: 'active' });
      await owner('post', `/api/v1/platform/sales-enquiries/${enquiry.id}/create-company`).send({ tenantType: 'brokerage', companyName: 'XX', tradeLicenseNo: 'TL', reraOrn: 'O', adminEmail: 'x@x.ae', adminFullName: 'XX', seats: 1, pricePerSeat: '1', billingCycle: 'monthly', paymentMethod: 'card' }).expect(409);
      const omar = await signIn(app, { email: 'omar@bigbrokers.ae', tenant: created.body.id });
      await omar.get('/api/v1/me').expect(200);
    });
  });

  describe('cancel, 90-day export, deletion (acceptance test 19)', () => {
    it('cancel at period end and undo; the end makes it read-only with export; after 90 days the data is deleted', async () => {
      const cancel = await admin.post('/api/v1/billing/subscription/cancel').send({ reason: 'Closing the office' }).expect(200);
      expect(cancel.body.cancelAtPeriodEnd).toBe(true);
      expect((await admin.post('/api/v1/billing/subscription/resume').expect(200)).body.cancelAtPeriodEnd).toBe(false);
      await admin.post('/api/v1/billing/subscription/cancel').send({}).expect(200);

      await webhook({ id: 'evt_deleted_1', type: 'customer.subscription.deleted', data: { object: { id: sub.subscriptionId, customer: sub.customerId } } }).expect(200);
      await drainStripe();
      const ended = await admin.get('/api/v1/billing/subscription').expect(200);
      expect(ended.body.status).toBe('canceled');
      expect(Math.round((new Date(ended.body.dataDeleteAfter).getTime() - Date.now()) / 86_400_000)).toBeGreaterThanOrEqual(89);
      await admin.post('/api/v1/leads').send({ fullName: 'x', phonePrimary: '+971558880009', sourceId: (await admin.get('/api/v1/lead-sources')).body.data[0].id }).expect(402);

      const exported = await admin.post('/api/v1/billing/data-export').expect(202);
      await app.get(QueueService).drain('report-export');
      const file = await admin.get(`/api/v1/exports/${exported.body.id}`).expect(200);
      expect(file.body).toMatchObject({ reportKey: 'company_data', status: 'completed', downloadUrl: expect.any(String) });

      expect(await app.get(BillingJobs).dataDeletion()).toEqual([]); // not yet: 90 days have not passed
      // 90 days later (the database function itself checks the real date before deleting anything).
      await ownerQuery(`UPDATE subscriptions SET data_delete_after = current_date - 1 WHERE tenant_id = $1`, [tenantId]);
      expect(await app.get(BillingJobs).dataDeletion()).toEqual([tenantId]);
      expect(await ownerQuery(`SELECT 1 FROM tenants WHERE id = $1`, [tenantId])).toEqual([]);
      expect(await ownerQuery(`SELECT 1 FROM leads WHERE tenant_id = $1`, [tenantId])).toEqual([]);
      await admin.get('/api/v1/me').expect(401);
    });
  });
});
