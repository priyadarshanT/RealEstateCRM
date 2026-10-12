import { INestApplication } from '@nestjs/common';
import { createTestApp, signIn, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

// Settings: tenant settings, currencies, lead stages, reasons, lead sources (SRS §2.19, §2.21, §11.5).
describe('settings module', () => {
  let app: INestApplication;
  let admin: Client;
  let agent: Client;
  let adminB: Client;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signIn(app, USERS.adminA);
    agent = await signIn(app, USERS.aliA);
    adminB = await signIn(app, USERS.adminB);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('tenant settings', () => {
    it('lists the defaults: 10-minute response time and scoring weights', async () => {
      const res = await admin.get('/api/v1/settings').expect(200);
      const byKey = Object.fromEntries(res.body.data.map((s: { key: string; value: unknown }) => [s.key, s.value]));
      expect(byKey['leads.response_time']).toEqual({ minutes: 10, next_agent_scope: 'team', fallback: 'admin' });
      expect(byKey['leads.scoring']).toEqual({ budget_fit: 30, project_match: 20, source_quality: 20, engagement: 30 });
      await agent.get('/api/v1/settings').expect(403);
    });

    it('Admin changes the response time; invalid values and unknown keys are refused', async () => {
      const res = await admin
        .put('/api/v1/settings/leads.response_time')
        .send({ value: { minutes: 15, next_agent_scope: 'team', fallback: 'admin' } })
        .expect(200);
      expect(res.body).toMatchObject({ key: 'leads.response_time', value: { minutes: 15 } });

      const bad = await admin.put('/api/v1/settings/leads.response_time').send({ value: { minutes: 0, next_agent_scope: 'team', fallback: 'admin' } }).expect(400);
      expect(bad.body.errors[0].field).toBe('value.minutes');
      await admin.put('/api/v1/settings/leads.scoring').send({ value: { budget_fit: 50, project_match: 50, source_quality: 50, engagement: 50 } }).expect(400);
      const unknown = await admin.put('/api/v1/settings/leads.auto_close').send({ value: { days: 30 } }).expect(422);
      expect(unknown.body.code).toBe('UNKNOWN_SETTING');

      const audit = await admin.get('/api/v1/audit-logs?entityType=tenant_settings').expect(200);
      expect(audit.body.data[0].changes['leads.response_time'][1]).toMatchObject({ minutes: 15 });
    });
  });

  describe('currencies', () => {
    it('everyone sees enabled currencies; Admin enables more with rates; the base currency stays enabled', async () => {
      const before = await agent.get('/api/v1/currencies').expect(200);
      expect(before.body.data).toEqual([{ code: 'AED', name: 'UAE Dirham', rateToBase: null }]);

      await agent.put('/api/v1/currencies').send({ currencies: [{ code: 'AED' }] }).expect(403);
      await admin.put('/api/v1/currencies').send({ currencies: [{ code: 'USD' }] }).expect(400);
      await admin.put('/api/v1/currencies').send({ currencies: [{ code: 'AED' }, { code: 'XYZ' }] }).expect(400);

      const set = await admin
        .put('/api/v1/currencies')
        .send({ currencies: [{ code: 'AED' }, { code: 'USD', rateToBase: '3.6725' }, { code: 'EUR', rateToBase: '4.01', effectiveDate: '2026-10-01' }] })
        .expect(200);
      expect(set.body.data).toEqual(['AED', 'EUR', 'USD']);

      const after = await agent.get('/api/v1/currencies').expect(200);
      expect(after.body.data).toEqual([
        { code: 'AED', name: 'UAE Dirham', rateToBase: null },
        { code: 'EUR', name: 'Euro', rateToBase: '4.01000000' },
        { code: 'USD', name: 'US Dollar', rateToBase: '3.67250000' },
      ]);
      const other = await adminB.get('/api/v1/currencies').expect(200);
      expect(other.body.data.map((c: { code: string }) => c.code)).toEqual(['AED']);
    });
  });

  describe('lead stages', () => {
    it('lists the 15 stages in stage-bar order; agents can read them', async () => {
      const res = await agent.get('/api/v1/lead-stages?limit=200').expect(200);
      expect(res.body.data).toHaveLength(15);
      expect(res.body.data[0]).toMatchObject({ key: 'new', category: 'open', sortOrder: 1, isSystem: true });
      expect(res.body.data.map((s: { key: string }) => s.key).slice(-3)).toEqual(['won', 'lost', 'invalid']);
      const page = await agent.get('/api/v1/lead-stages?limit=5').expect(200);
      const next = await agent.get(`/api/v1/lead-stages?limit=5&cursor=${page.body.page.nextCursor}`).expect(200);
      expect(next.body.data[0].sortOrder).toBe(6);
    });

    it('Admin adds, renames and deletes a custom stage; built-in stages are protected', async () => {
      await agent.post('/api/v1/lead-stages').send({ key: 'site_visit', name: 'Site Visit', category: 'open', sortOrder: 20 }).expect(403);
      const created = await admin.post('/api/v1/lead-stages').send({ key: 'site_visit', name: 'Site Visit', category: 'open', sortOrder: 20 }).expect(201);
      expect(created.body).toMatchObject({ isSystem: false, isActive: true });
      await admin.post('/api/v1/lead-stages').send({ key: 'site_visit', name: 'Again', category: 'open', sortOrder: 21 }).expect(409);
      await admin.post('/api/v1/lead-stages').send({ name: 'No key' }).expect(400);

      const etag = created.headers.etag as string;
      await admin.patch(`/api/v1/lead-stages/${created.body.id}`).set('If-Match', etag).send({ name: 'Site Visit Done' }).expect(200);
      await admin.patch(`/api/v1/lead-stages/${created.body.id}`).set('If-Match', etag).send({ name: 'Stale' }).expect(409);
      await admin.delete(`/api/v1/lead-stages/${created.body.id}`).expect(204);

      const stages = await admin.get('/api/v1/lead-stages?limit=200').expect(200);
      const lost = stages.body.data.find((s: { key: string }) => s.key === 'lost');
      await admin.delete(`/api/v1/lead-stages/${lost.id}`).expect(403);
      await admin.patch(`/api/v1/lead-stages/${lost.id}`).send({ category: 'open' }).expect(403);
      const renamed = await admin.patch(`/api/v1/lead-stages/${lost.id}`).send({ name: 'Lost deal' }).expect(200);
      expect(renamed.body).toMatchObject({ key: 'lost', name: 'Lost deal', category: 'lost' });
    });

    it("another tenant's stage is not found", async () => {
      const warm = (await admin.get('/api/v1/lead-stages?limit=200').expect(200)).body.data.find((s: { key: string }) => s.key === 'warm');
      await adminB.get(`/api/v1/lead-stages/${warm.id}`).expect(404);
      await adminB.delete(`/api/v1/lead-stages/${warm.id}`).expect(404);
    });
  });

  describe('reasons', () => {
    it('lists reasons by type; Admin adds and removes custom ones; built-in reasons are protected', async () => {
      const lost = await agent.get('/api/v1/reasons?type=lost').expect(200);
      expect(lost.body.data.map((r: { name: string }) => r.name)).toEqual(['Bought elsewhere', 'Budget too low', 'Not interested']);

      const created = await admin.post('/api/v1/reasons').send({ type: 'lost', name: 'Chose rental' }).expect(201);
      await admin.post('/api/v1/reasons').send({ type: 'lost', name: 'Chose rental' }).expect(409);
      await admin.post('/api/v1/reasons').send({ type: 'lost', name: 'With key', key: 'custom' }).expect(400);
      await admin.patch(`/api/v1/reasons/${created.body.id}`).send({ isActive: false }).expect(200);
      await admin.delete(`/api/v1/reasons/${created.body.id}`).expect(204);

      const reassignment = await admin.get('/api/v1/reasons?type=reassignment').expect(200);
      const noResponse = reassignment.body.data.find((r: { key: string }) => r.key === 'no_response');
      await admin.delete(`/api/v1/reasons/${noResponse.id}`).expect(403);
      await admin.patch(`/api/v1/reasons/${noResponse.id}`).send({ type: 'lost' }).expect(403);
    });
  });

  describe('lead sources', () => {
    it('Admin adds a source with a quality score; names are unique; agents can read', async () => {
      const created = await admin.post('/api/v1/lead-sources').send({ type: 'website', name: 'Website form', qualityScore: 70 }).expect(201);
      expect(created.body).toMatchObject({ type: 'website', qualityScore: 70, integrationId: null, isActive: true });
      await admin.post('/api/v1/lead-sources').send({ type: 'website', name: 'Website form' }).expect(409);
      await admin.post('/api/v1/lead-sources').send({ type: 'fax', name: 'Fax' }).expect(400);
      await admin.post('/api/v1/lead-sources').send({ type: 'meta', name: 'Meta (unlinked)', integrationId: '00000000-0000-4000-8000-000000000000' }).expect(400);
      const updated = await admin.patch(`/api/v1/lead-sources/${created.body.id}`).send({ qualityScore: 80 }).expect(200);
      expect(updated.body.qualityScore).toBe(80);

      const list = await agent.get('/api/v1/lead-sources').expect(200);
      expect(list.body.data.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(['Manual entry', 'Excel / CSV import', 'Website form']));
      await admin.delete(`/api/v1/lead-sources/${created.body.id}`).expect(204);
    });
  });
});
