import { INestApplication } from '@nestjs/common';
import { DbService } from '../src/core/database/db.service';
import { MarketingService } from '../src/modules/marketing/marketing.service';
import { createTestApp, signIn, TENANT_A, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

const SOURCE_META_A = 'a1000000-0000-0000-0000-000000000001';

// Ad campaigns, daily spend and events (SRS §8.3, §8.5).
describe('campaigns, ad spend, events', () => {
  let app: INestApplication;
  let admin: Client;
  let agent: Client;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signIn(app, USERS.adminA);
    agent = await signIn(app, USERS.aliA);
  });

  afterAll(async () => {
    await app.close();
  });

  it('Admin creates and edits campaigns; agents can read them', async () => {
    await agent.post('/api/v1/campaigns').send({ sourceId: SOURCE_META_A, name: 'X' }).expect(403);
    const created = await admin.post('/api/v1/campaigns').send({ sourceId: SOURCE_META_A, name: 'Marina launch', externalId: 'META-CMP-77', startsOn: '2026-10-01' }).expect(201);
    expect(created.body).toMatchObject({ status: 'active', startsOn: '2026-10-01', endsOn: null });
    await admin.post('/api/v1/campaigns').send({ sourceId: SOURCE_META_A, name: 'Dup', externalId: 'META-CMP-77' }).expect(409);
    await admin.patch(`/api/v1/campaigns/${created.body.id}`).send({ endsOn: '2026-09-01' }).expect(400);
    const paused = await admin.patch(`/api/v1/campaigns/${created.body.id}`).set('If-Match', created.headers.etag as string).send({ status: 'paused' }).expect(200);
    expect(paused.body.status).toBe('paused');
    const list = await agent.get(`/api/v1/campaigns?sourceId=${SOURCE_META_A}&status=paused`).expect(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toContain(created.body.id);
  });

  it('manual spend is entered per day; days imported from the ad platform are not overwritten by hand', async () => {
    const campaign = (await admin.post('/api/v1/campaigns').send({ sourceId: SOURCE_META_A, name: 'Spend test' }).expect(201)).body;
    await admin
      .put(`/api/v1/campaigns/${campaign.id}/spend`)
      .send({ days: [{ spendDate: '2026-10-01', amount: '1200.5', currency: 'AED' }, { spendDate: '2026-10-02', amount: '800', currency: 'AED' }] })
      .expect(204);
    await app.get(DbService).withTenant(TENANT_A, () => app.get(MarketingService).importSpend(campaign.id, { spendDate: '2026-10-02', amount: '950.00', currency: 'AED' }));
    await admin.put(`/api/v1/campaigns/${campaign.id}/spend`).send({ days: [{ spendDate: '2026-10-02', amount: '1.00', currency: 'AED' }] }).expect(204);
    const spend = await agent.get(`/api/v1/campaigns/${campaign.id}/spend?from=2026-10-01&to=2026-10-31`).expect(200);
    expect(spend.body.data).toEqual([
      { spendDate: '2026-10-01', amount: '1200.50', currency: 'AED', entryMethod: 'manual' },
      { spendDate: '2026-10-02', amount: '950.00', currency: 'AED', entryMethod: 'api' },
    ]);
    await admin.put(`/api/v1/campaigns/${campaign.id}/spend`).send({ days: [{ spendDate: '2026-10-03', amount: '-5', currency: 'AED' }] }).expect(400);
  });

  it('events: create, tag a lead, cannot delete while leads are tagged', async () => {
    const event = await admin
      .post('/api/v1/events')
      .send({ name: 'London roadshow', type: 'roadshow', location: 'London', startsAt: '2026-11-05T09:00:00Z', endsAt: '2026-11-06T18:00:00Z', cost: '45000', currency: 'AED' })
      .expect(201);
    expect(event.body).toMatchObject({ cost: '45000.00', currency: 'AED' });
    await admin.post('/api/v1/events').send({ name: 'Bad', type: 'event', startsAt: '2026-11-05T09:00:00Z', endsAt: '2026-11-04T09:00:00Z' }).expect(400);
    await admin.post('/api/v1/events').send({ name: 'No currency', type: 'event', startsAt: '2026-11-05T09:00:00Z', endsAt: '2026-11-05T10:00:00Z', cost: '10' }).expect(400);

    await admin.post('/api/v1/leads').send({ fullName: 'Roadshow visitor', phonePrimary: '+447700900123', sourceId: SOURCE_META_A, eventId: event.body.id }).expect(201);
    const tagged = await admin.get(`/api/v1/leads?eventId=${event.body.id}`).expect(200);
    expect(tagged.body.data).toHaveLength(1);
    await admin.delete(`/api/v1/events/${event.body.id}`).expect(409);

    const spare = await admin.post('/api/v1/events').send({ name: 'Open house', type: 'open_house', startsAt: '2026-12-01T09:00:00Z', endsAt: '2026-12-01T12:00:00Z' }).expect(201);
    await admin.delete(`/api/v1/events/${spare.body.id}`).expect(204);
    const list = await agent.get('/api/v1/events').expect(200);
    expect(list.body.data.map((e: { name: string }) => e.name)).toContain('London roadshow');
  });
});
