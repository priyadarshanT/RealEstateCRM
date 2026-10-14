import { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { QueueService } from '../src/core/queue/queue.service';
import { META_API, MetaApi, MetaLead } from '../src/modules/integrations/meta/meta-api';
import { IncomingLeadIntake } from '../src/modules/integrations/inbox/incoming-lead-intake';
import { createTestApp, ownerQuery, signIn, TENANT_B, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

const APP_SECRET = 'test-meta-app-secret';
process.env.META_APP_ID = 'test-app';
process.env.META_APP_SECRET = APP_SECRET;
process.env.META_VERIFY_TOKEN = 'test-verify-token';

/** Fake Meta Graph API: one page, leads served from a map, optional failures. */
class FakeMeta implements MetaApi {
  leads = new Map<string, MetaLead>();
  failNext = 0;
  subscribed: string[] = [];
  /** Lead IDs Meta reports for the Meta check. */
  sourceIds: string[] = [];
  authorizeUrl(state: string, redirectUri: string) {
    return `https://facebook.test/dialog?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }
  async exchangeCode(code: string) {
    if (code !== 'good-code') throw new Error('bad code');
    return 'user-token';
  }
  async pages() {
    return [{ id: 'PAGE-1', name: 'Al Noor B Page', accessToken: 'page-token' }];
  }
  async subscribePage(pageId: string) {
    this.subscribed.push(pageId);
  }
  async fetchLead(id: string, token: string) {
    if (token !== 'page-token') throw new Error('wrong token');
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('Meta API 500: temporary error');
    }
    const lead = this.leads.get(id);
    if (!lead) throw new Error(`Meta API 404: lead ${id}`);
    return lead;
  }
  async check() {
    return { ok: true, detail: 'Connected to page Al Noor B Page' };
  }
  async listLeadIds(pageId: string, token: string) {
    if (pageId !== 'PAGE-1' || token !== 'page-token') throw new Error('wrong page');
    return this.sourceIds;
  }
}

// Meta lead ads (SRS §2.1–2.3, §11; architecture §4): connect, webhook, intake, duplicates, failures and retry.
describe('Meta lead ads', () => {
  let app: INestApplication;
  let admin: Client;
  let agent: Client;
  const fake = new FakeMeta();
  let integrationId: string;

  const webhook = (body: object, secret = APP_SECRET) => {
    const raw = JSON.stringify(body);
    const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    return request(app.getHttpServer()).post('/api/v1/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature).send(raw);
  };
  const leadgen = (leadgenId: string, pageId = 'PAGE-1') => ({
    object: 'page',
    entry: [{ id: pageId, time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: leadgenId, page_id: pageId, form_id: 'FORM-9', created_time: 1760000000 } }] }],
  });

  beforeAll(async () => {
    app = await createTestApp((b) => b.overrideProvider(META_API).useValue(fake));
    admin = await signIn(app, USERS.adminB);
    agent = await signIn(app, USERS.aliA); // an agent: no settings.manage
  });

  afterAll(async () => {
    await app.close();
  });

  it('connects a page through OAuth; the state is signed and single-use', async () => {
    const phase2 = await admin.post('/api/v1/integrations').send({ provider: 'tiktok' }).expect(400);
    expect(phase2.body.errors[0].message).toMatch(/cannot be connected yet/);

    const start = await admin.post('/api/v1/integrations').send({ provider: 'meta' }).expect(201);
    integrationId = start.body.integrationId;
    const state = new URL(start.body.authorizeUrl).searchParams.get('state')!;
    expect(new URL(start.body.authorizeUrl).searchParams.get('redirect_uri')).toBe('http://localhost:4000/api/v1/oauth/meta/callback');

    const tampered = await request(app.getHttpServer()).get(`/api/v1/oauth/meta/callback?code=good-code&state=${state}x`).expect(302);
    expect(tampered.headers.location).toContain('error=invalid_state');
    const ok = await request(app.getHttpServer()).get(`/api/v1/oauth/meta/callback?code=good-code&state=${encodeURIComponent(state)}`).expect(302);
    expect(ok.headers.location).toBe(`http://localhost:3000/settings?tab=connections&connected=${integrationId}`);
    const again = await request(app.getHttpServer()).get(`/api/v1/oauth/meta/callback?code=good-code&state=${encodeURIComponent(state)}`).expect(302);
    expect(again.headers.location).toContain('error=invalid_state');

    const row = await admin.get(`/api/v1/integrations/${integrationId}`).expect(200);
    expect(row.body).toMatchObject({ provider: 'meta', status: 'connected', accountLabel: 'Al Noor B Page', settings: { pageId: 'PAGE-1' } });
    expect(row.body.settings.oauthNonce).toBeUndefined();
    expect(fake.subscribed).toEqual(['PAGE-1']);
    const stored = await ownerQuery<{ secret_ref: string }>(`SELECT secret_ref FROM integrations WHERE id = $1`, [integrationId]);
    expect(stored[0]!.secret_ref).toMatch(new RegExp(`/tenants/${TENANT_B}/integrations/${integrationId}$`));
    expect((await admin.post(`/api/v1/integrations/${integrationId}/test`).expect(200)).body.ok).toBe(true);
    await agent.get('/api/v1/integrations').expect(403);
  });

  it('Meta verifies the webhook with the verify token', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345').expect(200);
    expect(res.text).toBe('12345');
    await request(app.getHttpServer()).get('/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1').expect(403);
  });

  it('a signed lead is saved, acknowledged, then imported with all its IDs and answers; duplicates are ignored', async () => {
    fake.leads.set('LG-100', {
      id: 'LG-100',
      createdTime: new Date('2026-10-12T08:30:00Z'),
      fieldData: [
        { name: 'full_name', values: ['Priya Sharma'] },
        { name: 'phone_number', values: ['+971 55 987 1122'] },
        { name: 'email', values: ['Priya@Mail.com'] },
        { name: 'which_project?', values: ['Sobha Hartland'] },
      ],
      formId: 'FORM-9',
      formName: 'Hartland launch',
      adId: 'AD-3',
      adsetId: 'ADSET-2',
      campaignId: 'CMP-1',
      campaignName: 'Hartland October',
    });
    await webhook(leadgen('LG-100'), 'wrong-secret').expect(401);
    const ack = await webhook(leadgen('LG-100')).expect(200);
    expect(ack.body).toEqual({ received: true });
    await webhook(leadgen('LG-100')).expect(200); // Meta retries: stored once
    expect(await app.get(QueueService).drain('lead-intake')).toBe(1);

    const leads = await admin.get('/api/v1/leads?q=Priya%20Sharma').expect(200);
    expect(leads.body.data).toHaveLength(1);
    const lead = leads.body.data[0];
    expect(lead).toMatchObject({ phonePrimary: '+971559871122', email: 'priya@mail.com', campaignId: expect.any(String) });
    const inquiry = (await admin.get(`/api/v1/leads/${lead.id}/inquiries`).expect(200)).body.data[0];
    expect(inquiry).toMatchObject({
      externalSubmissionId: 'LG-100',
      externalFormId: 'FORM-9',
      externalAdId: 'AD-3',
      externalAdsetId: 'ADSET-2',
      externalCampaignId: 'CMP-1',
      formName: 'Hartland launch',
      submittedAt: '2026-10-12T08:30:00.000Z',
      formAnswers: { 'which_project?': 'Sobha Hartland', full_name: 'Priya Sharma' },
    });
    const campaign = await admin.get(`/api/v1/campaigns/${lead.campaignId}`).expect(200);
    expect(campaign.body).toMatchObject({ name: 'Hartland October', externalId: 'CMP-1' });

    const events = await admin.get(`/api/v1/integrations/${integrationId}/events`).expect(200);
    expect(events.body.data).toHaveLength(1);
    expect(events.body.data[0]).toMatchObject({ externalEventId: 'LG-100', status: 'processed', attempts: 1 });
    const list = await admin.get('/api/v1/integrations').expect(200);
    // Other test files may connect more providers in tenant B (e.g. an email sender): find this one by ID.
    expect(list.body.data.find((i: { id: string }) => i.id === integrationId)).toMatchObject({ recordsReceived30d: 1, failures30d: 0 });
  });

  it('a lead for an unknown page is stored as ignored', async () => {
    await webhook(leadgen('LG-200', 'PAGE-UNKNOWN')).expect(200);
    const rows = await ownerQuery<{ status: string; tenant_id: string | null }>(`SELECT status, tenant_id FROM webhook_events WHERE external_event_id = 'LG-200'`);
    expect(rows[0]).toEqual({ status: 'ignored', tenant_id: null });
  });

  it('failures retry up to 5 times, then show as failed; Retry puts them back in the queue', async () => {
    fake.leads.set('LG-300', { id: 'LG-300', createdTime: new Date(), fieldData: [{ name: 'phone_number', values: ['+971559870300'] }] });
    fake.failNext = 5;
    await webhook(leadgen('LG-300')).expect(200);
    const [event] = await ownerQuery<{ id: string }>(`SELECT id FROM webhook_events WHERE external_event_id = 'LG-300'`);
    const intake = app.get(IncomingLeadIntake);
    const { DbService } = await import('../src/core/database/db.service');
    const db = app.get(DbService);
    for (let i = 0; i < 5; i++) await db.withTenant(TENANT_B, () => intake.process(event!.id));
    const failed = await admin.get(`/api/v1/integrations/${integrationId}/events?status=failed`).expect(200);
    expect(failed.body.data[0]).toMatchObject({ externalEventId: 'LG-300', attempts: 5, lastError: 'Meta API 500: temporary error' });
    const integration = await admin.get(`/api/v1/integrations/${integrationId}`).expect(200);
    expect(integration.body).toMatchObject({ failures30d: 1, lastError: 'Meta API 500: temporary error' });

    const retried = await admin.post(`/api/v1/integrations/${integrationId}/retry`).expect(202);
    expect(retried.body).toEqual({ requeued: 1 });
    await db.withTenant(TENANT_B, () => intake.process(event!.id));
    const after = await admin.get(`/api/v1/integrations/${integrationId}/events?status=processed`).expect(200);
    expect(after.body.data.map((e: { externalEventId: string }) => e.externalEventId)).toContain('LG-300');
    await admin.post(`/api/v1/webhook-events/${event!.id}/retry`).expect(409);
  });

  it('the Meta check compares Meta with the CRM and recovers missing leads (SRS §8.7)', async () => {
    fake.leads.set('LG-500', { id: 'LG-500', createdTime: new Date(), fieldData: [{ name: 'full_name', values: ['Omar Recovered'] }, { name: 'phone_number', values: ['+971559870500'] }] });
    fake.sourceIds = ['LG-100', 'LG-300', 'LG-500', 'LG-500'];
    const period = { periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-10-15T00:00:00Z' };
    await agent.post(`/api/v1/integrations/${integrationId}/reconciliations`).send(period).expect(403);
    const bad = await admin.post(`/api/v1/integrations/${integrationId}/reconciliations`).send({ periodStart: period.periodEnd, periodEnd: period.periodStart }).expect(400);
    expect(bad.body.errors[0].field).toBe('periodEnd');

    const started = await admin.post(`/api/v1/integrations/${integrationId}/reconciliations`).send(period).expect(202);
    expect(started.body).toMatchObject({ integrationId, status: 'running', periodStart: '2026-10-01T00:00:00.000Z' });
    const queue = app.get(QueueService);
    expect(await queue.drain('meta-reconciliation')).toBe(1);
    const runs = await admin.get(`/api/v1/reconciliations?integrationId=${integrationId}`).expect(200);
    expect(runs.body.data[0]).toMatchObject({ id: started.body.id, status: 'completed', sourceCount: 3, crmCount: 2, missingExternalIds: ['LG-500'], recoveredCount: 1 });

    await queue.drain('lead-intake');
    expect((await admin.get('/api/v1/leads?q=Omar%20Recovered').expect(200)).body.data).toHaveLength(1);
    // Nothing missing any more on the next check.
    await admin.post(`/api/v1/integrations/${integrationId}/reconciliations`).send({ ...period, recoverMissing: false }).expect(202);
    await queue.drain('meta-reconciliation');
    expect((await admin.get('/api/v1/reconciliations').expect(200)).body.data[0]).toMatchObject({ sourceCount: 3, crmCount: 3, missingExternalIds: [], recoveredCount: 0 });
  });

  it('disconnect removes the token; new leads for the page are ignored', async () => {
    await admin.delete(`/api/v1/integrations/${integrationId}`).expect(204);
    const row = await admin.get(`/api/v1/integrations/${integrationId}`).expect(200);
    expect(row.body.status).toBe('disconnected');
    await webhook(leadgen('LG-400')).expect(200);
    const rows = await ownerQuery<{ status: string }>(`SELECT status FROM webhook_events WHERE external_event_id = 'LG-400'`);
    expect(rows[0]!.status).toBe('ignored');
  });
});
