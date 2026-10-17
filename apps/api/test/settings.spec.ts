import { INestApplication } from '@nestjs/common';
import { createTestApp, signIn, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

// Global Configuration: tenant settings, currencies, lead statuses and substatuses, reasons, lead sources.
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

  describe('Global Configuration settings', () => {
    it('lists the defaults: exports and messages to unassigned leads off, copy and paste allowed', async () => {
      const res = await admin.get('/api/v1/settings').expect(200);
      const byKey = Object.fromEntries(res.body.data.map((s: { key: string; value: unknown }) => [s.key, s.value]));
      expect(byKey['leads.features']).toMatchObject({ export_leads: false, unassigned_communication: false, past_date_selection: false, hide_contact_info: { enabled: false, role_keys: [] } });
      expect(byKey['security.policy']).toEqual({ require_2fa: false, allow_copy_paste: true, disable_screenshots: false });
      expect(byKey['general.preferences']).toMatchObject({ default_country: 'AE', default_currency: 'AED', watermark: { enabled: false } });
    });

    it('a change saved by someone else first is refused; history shows who changed what', async () => {
      const first = await admin.get('/api/v1/settings/security.policy').expect(200);
      expect(first.body.updatedAt).toBeNull();
      const etag = first.headers.etag as string;
      const saved = await admin.put('/api/v1/settings/security.policy').set('If-Match', etag).send({ value: { require_2fa: true, allow_copy_paste: false, disable_screenshots: false } }).expect(200);
      expect(saved.body.value).toMatchObject({ require_2fa: true, allow_copy_paste: false });
      await admin.put('/api/v1/settings/security.policy').set('If-Match', etag).send({ value: { require_2fa: false, allow_copy_paste: true, disable_screenshots: false } }).expect(409);
      await admin.put('/api/v1/settings/security.policy').set('If-Match', saved.headers.etag as string).send({ value: { require_2fa: false, allow_copy_paste: true, disable_screenshots: false } }).expect(200);

      const history = await admin.get('/api/v1/settings/security.policy/history').expect(200);
      expect(history.body.data).toHaveLength(2);
      expect(history.body.data[1]).toMatchObject({ userName: expect.any(String), before: { require_2fa: false }, after: { require_2fa: true } });
      await agent.get('/api/v1/settings/security.policy/history').expect(403);
      await agent.put('/api/v1/settings/security.policy').send({ value: { require_2fa: false, allow_copy_paste: true, disable_screenshots: false } }).expect(403);
      // Another company still has the defaults.
      expect((await adminB.get('/api/v1/settings/security.policy').expect(200)).body.updatedAt).toBeNull();
    });

    it('dependent switches are checked: secondary owner notification needs dual ownership; hidden contact info needs a role', async () => {
      const base = {
        export_leads: false, source_update: false, dual_ownership: false, secondary_owner_notification: false, past_date_selection: false,
        hide_contact_info: { enabled: false, role_keys: [] }, mandatory_location: false, unassigned_communication: false,
      };
      const a = await admin.put('/api/v1/settings/leads.features').send({ value: { ...base, secondary_owner_notification: true } }).expect(400);
      expect(a.body.errors[0].field).toBe('value.secondary_owner_notification');
      const b = await admin.put('/api/v1/settings/leads.features').send({ value: { ...base, hide_contact_info: { enabled: true, role_keys: [] } } }).expect(400);
      expect(b.body.errors[0].field).toBe('value.hide_contact_info.role_keys');
      await admin.put('/api/v1/settings/general.preferences').send({ value: { call_notifications: true, call_detection: false, default_country: 'uae', default_currency: 'AED', watermark: { enabled: false, kind: 'text', text: '', opacity: 20, position: 'center', apply_to: [] } } }).expect(400);
      await admin.put('/api/v1/settings/general.preferences').send({ value: { call_notifications: true, call_detection: false, default_country: 'AE', default_currency: 'AED', watermark: { enabled: true, kind: 'text', text: '', opacity: 20, position: 'center', apply_to: ['images'] } } }).expect(400);
      await admin.put('/api/v1/settings/general.preferences').send({ value: { call_notifications: true, call_detection: false, default_country: 'AE', default_currency: 'AED', watermark: { enabled: true, kind: 'text', text: 'Al Noor Realty', opacity: 20, position: 'center', apply_to: ['images'] } } }).expect(200);
    });
  });

  describe('lead statuses and substatuses', () => {
    it('lists the four fixed statuses; they cannot be added or deleted', async () => {
      const res = await agent.get('/api/v1/lead-stages?limit=200').expect(200);
      expect(res.body.data.map((s: { key: string; category: string }) => [s.key, s.category])).toEqual([
        ['hot', 'open'],
        ['warm', 'open'],
        ['cold', 'lost'],
        ['sale_done', 'won'],
      ]);
      expect(res.body.data[0]).toMatchObject({ name: 'Hot', isSystem: true, requiresScheduling: true, color: expect.stringMatching(/^#/) });
      await admin.post('/api/v1/lead-stages').send({ key: 'site_visit', name: 'Site Visit', category: 'open', sortOrder: 20 }).expect(404);
      await admin.delete(`/api/v1/lead-stages/${res.body.data[0].id}`).expect(404);
    });

    it('only the Admin adds, renames, reorders, turns off and deletes substatuses', async () => {
      const stages = (await admin.get('/api/v1/lead-stages?limit=200').expect(200)).body.data as { key: string; id: string }[];
      const hot = stages.find((s) => s.key === 'hot')!.id;
      const listed = await agent.get(`/api/v1/lead-substatuses?stageId=${hot}`).expect(200);
      expect(listed.body.data.map((s: { name: string }) => s.name)).toEqual(['Zoom Schedule', 'Event Attended', 'Zoom Done', 'Viewing Schedule', 'Potential Buyer', 'Immediate Buyer']);

      await agent.post('/api/v1/lead-substatuses').send({ stageId: hot, name: 'Site Visit' }).expect(403);
      const created = await admin.post('/api/v1/lead-substatuses').send({ stageId: hot, name: 'Site Visit', requiresScheduling: true }).expect(201);
      expect(created.body).toMatchObject({ name: 'Site Visit', sortOrder: 7, isActive: true, requiresScheduling: true });
      await admin.post('/api/v1/lead-substatuses').send({ stageId: hot, name: 'site visit' }).expect(409);
      await admin.post('/api/v1/lead-substatuses').send({ name: 'No status' }).expect(400);

      const etag = created.headers.etag as string;
      await admin.patch(`/api/v1/lead-substatuses/${created.body.id}`).set('If-Match', etag).send({ name: 'Site Visit Booked' }).expect(200);
      await admin.patch(`/api/v1/lead-substatuses/${created.body.id}`).set('If-Match', etag).send({ name: 'Stale' }).expect(409);
      await agent.patch(`/api/v1/lead-substatuses/${created.body.id}`).send({ isActive: false }).expect(403);

      const ids = listed.body.data.map((s: { id: string }) => s.id);
      await admin.put('/api/v1/lead-substatuses/order').send({ stageId: hot, ids }).expect(400);
      const reordered = await admin.put('/api/v1/lead-substatuses/order').send({ stageId: hot, ids: [created.body.id, ...ids] }).expect(200);
      expect(reordered.body.data[0]).toMatchObject({ id: created.body.id, sortOrder: 1 });

      await admin.delete(`/api/v1/lead-substatuses/${created.body.id}`).expect(204);
      await adminB.get(`/api/v1/lead-substatuses/${ids[0]}`).expect(404);
    });
  });

  describe('reasons', () => {
    it('lists reasons by type; Admin adds and removes custom ones; built-in reasons are protected', async () => {
      // Lost / Invalid reasons gave way to the Cold substatuses (migration 0006); reassignment reasons remain.
      const lost = await agent.get('/api/v1/reasons?type=lost').expect(200);
      expect(lost.body.data).toEqual([]);

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
