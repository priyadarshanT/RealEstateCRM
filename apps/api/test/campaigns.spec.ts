import { INestApplication } from '@nestjs/common';
import { QueueService } from '../src/core/queue/queue.service';
import { createTestApp, ownerQuery, signIn, TENANT_B, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

// Bulk WhatsApp campaigns (SRS §5.3–5.5, §15.9) in tenant B with MESSAGING_MODE=simulate: audience from lead filters,
// test, approval by another manager, opted-out leads left out (also when they opt out after submitting), report.
describe('bulk campaigns', () => {
  let app: INestApplication;
  let queue: QueueService;
  let admin: Client;
  let manager: Client;
  let director: Client;
  let agent: Client;
  let sourceId: string;
  let templateId: string;
  let campaignId: string;
  const leadIds: string[] = [];
  const MANAGER = { id: 'b0000000-0000-0000-0000-0000000000c1', email: 'camp.manager@b.ae', tenant: TENANT_B, role: 'sales_manager' };
  const DIRECTOR = { id: 'b0000000-0000-0000-0000-0000000000c2', email: 'camp.director@b.ae', tenant: TENANT_B, role: 'director' };
  const AGENT = { id: 'b0000000-0000-0000-0000-0000000000c3', email: 'camp.agent@b.ae', tenant: TENANT_B, role: 'sales_agent' };

  beforeAll(async () => {
    app = await createTestApp();
    queue = app.get(QueueService);
    for (const u of [MANAGER, DIRECTOR, AGENT]) {
      await ownerQuery(
        `INSERT INTO users (id, tenant_id, email, full_name, role_id, status)
         SELECT $1, $2, $3, $4, id, 'active' FROM roles WHERE tenant_id = $2 AND key = $5 ON CONFLICT (id) DO NOTHING`,
        [u.id, u.tenant, u.email, u.email.split('@')[0], u.role],
      );
    }
    await ownerQuery(`UPDATE tenants SET verification_status = 'verified', verified_at = coalesce(verified_at, now()) WHERE id = $1`, [TENANT_B]);
    admin = await signIn(app, USERS.adminB);
    manager = await signIn(app, MANAGER);
    director = await signIn(app, DIRECTOR);
    agent = await signIn(app, AGENT);
    await admin.post('/api/v1/integrations').send({ provider: 'whatsapp_cloud', settings: { phoneNumberId: '5005', wabaId: '6006' } }).expect(201);
    sourceId = (await admin.post('/api/v1/lead-sources').send({ type: 'website', name: 'Campaign audience source' }).expect(201)).body.id;
    for (const [i, name] of ['Omar Khan', 'Sara Lee', 'Nadia Faris', 'Ivan Petrov'].entries()) {
      const lead = await admin.post('/api/v1/leads').send({ fullName: name, phonePrimary: `+9715580000${i}1`, sourceId, ownerUserId: MANAGER.id }).expect(201);
      leadIds.push(lead.body.id);
    }
    // Ivan opted out of WhatsApp before the campaign.
    await manager.post(`/api/v1/leads/${leadIds[3]}/consents`).send({ channel: 'whatsapp', status: 'opted_out', captureMethod: 'reply' }).expect(201);
    templateId = (
      await admin
        .post('/api/v1/message-templates')
        .send({ channel: 'whatsapp', name: 'launch_invite', category: 'marketing', body: 'Hi {{first_name}}, our new launch opens Saturday.', variables: [{ name: 'first_name' }] })
        .expect(201)
    ).body.id;
    await admin.post(`/api/v1/message-templates/${templateId}/submit`).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('only campaigns.create may create; the audience is a valid lead filter; templates may only use lead fields', async () => {
    await agent.post('/api/v1/message-campaigns').send({ name: 'x', channel: 'whatsapp', templateId, audienceFilter: { sourceId } }).expect(403);
    const badKey = await manager.post('/api/v1/message-campaigns').send({ name: 'x', channel: 'whatsapp', templateId, audienceFilter: { colour: 'red' } }).expect(400);
    expect(badKey.body.errors).toEqual([{ field: 'audienceFilter.colour', message: 'not a lead filter' }]);
    const badValue = await manager.post('/api/v1/message-campaigns').send({ name: 'x', channel: 'whatsapp', templateId, audienceFilter: { stageId: 'nope' } }).expect(400);
    expect(badValue.body.errors[0].field).toBe('audienceFilter.stageId');

    const custom = (
      await admin
        .post('/api/v1/message-templates')
        .send({ channel: 'whatsapp', name: 'price_drop', category: 'marketing', body: 'Hi {{first_name}}, {{unit}} is now cheaper.', variables: [{ name: 'first_name' }, { name: 'unit' }] })
        .expect(201)
    ).body.id;
    await admin.post(`/api/v1/message-templates/${custom}/submit`).expect(200);
    const refused = await manager.post('/api/v1/message-campaigns').send({ name: 'x', channel: 'whatsapp', templateId: custom, audienceFilter: { sourceId } }).expect(400);
    expect(refused.body.errors[0].message).toMatch(/\{\{unit\}\}/);

    const created = await manager.post('/api/v1/message-campaigns').send({ name: 'Saturday launch', channel: 'whatsapp', templateId, audienceFilter: { sourceId } }).expect(201);
    expect(created.body).toMatchObject({ status: 'draft', createdBy: MANAGER.id, integrationId: expect.any(String), audienceCount: null });
    campaignId = created.body.id;
  });

  it('previews the audience without opted-out leads', async () => {
    const preview = await manager.post(`/api/v1/message-campaigns/${campaignId}/preview-audience`).expect(200);
    expect(preview.body).toMatchObject({ count: 3, excludedOptedOut: 1 });
    expect(preview.body.sample.map((s: { name: string }) => s.name).sort()).toEqual(['Nadia Faris', 'Omar Khan', 'Sara Lee']);
  });

  it('a test is required before submitting; submitting fixes the audience', async () => {
    const noTest = await manager.post(`/api/v1/message-campaigns/${campaignId}/submit`).expect(422);
    expect(noTest.body.code).toBe('TEST_REQUIRED');
    await manager.post(`/api/v1/message-campaigns/${campaignId}/test`).send({ to: 'not-a-phone' }).expect(400);
    await manager.post(`/api/v1/message-campaigns/${campaignId}/test`).send({ to: '+971500009999' }).expect(202);
    const submitted = await manager.post(`/api/v1/message-campaigns/${campaignId}/submit`).expect(200);
    expect(submitted.body).toMatchObject({ status: 'pending_approval', audienceCount: 3 });
    await manager.patch(`/api/v1/message-campaigns/${campaignId}`).send({ name: 'Changed' }).expect(409);
  });

  it('the creator cannot approve; campaigns.approve is needed; a rejection needs a note and returns it to draft on edit', async () => {
    await manager.post(`/api/v1/message-campaigns/${campaignId}/approve`).expect(403);
    const own = (await director.post('/api/v1/message-campaigns').send({ name: 'Director own', channel: 'whatsapp', templateId, audienceFilter: { sourceId } }).expect(201)).body.id;
    await director.post(`/api/v1/message-campaigns/${own}/test`).send({ to: '+971500009998' }).expect(202);
    await director.post(`/api/v1/message-campaigns/${own}/submit`).expect(200);
    const self = await director.post(`/api/v1/message-campaigns/${own}/approve`).expect(422);
    expect(self.body.code).toBe('SELF_APPROVAL');

    await director.post(`/api/v1/message-campaigns/${own}/reject`).send({}).expect(400);
    const rejected = await admin.post(`/api/v1/message-campaigns/${own}/reject`).send({ note: 'Wrong day' });
    expect(rejected.status).toBe(403); // Admin has no campaign permissions (SRS §13)
    const byManager = await director.post(`/api/v1/message-campaigns/${own}/reject`).send({ note: 'Wrong day' }).expect(200);
    expect(byManager.body).toMatchObject({ status: 'rejected', rejectionNote: 'Wrong day' });
    const edited = await director.patch(`/api/v1/message-campaigns/${own}`).send({ name: 'Director own v2' }).expect(200);
    expect(edited.body).toMatchObject({ status: 'draft', rejectionNote: null });
    expect((await director.post(`/api/v1/message-campaigns/${own}/submit`).expect(422)).body.code).toBe('TEST_REQUIRED');
  });

  it('approved: opted-out people are left out, also if they opted out after submitting; the report adds up', async () => {
    // Nadia opts out after the campaign was submitted but before it is sent.
    await manager.post(`/api/v1/leads/${leadIds[2]}/consents`).send({ channel: 'whatsapp', status: 'opted_out', captureMethod: 'manual' }).expect(201);
    const approved = await director.post(`/api/v1/message-campaigns/${campaignId}/approve`).expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', approvedBy: DIRECTOR.id });

    await queue.drain('campaign-dispatch');
    await queue.drain('send-message');

    const report = await manager.get(`/api/v1/message-campaigns/${campaignId}/report`).expect(200);
    expect(report.body).toEqual({ audience: 4, skippedOptedOut: 2, sent: 2, delivered: 0, failed: 0, replied: 0, optedOut: 0 });
    expect((await manager.get(`/api/v1/message-campaigns/${campaignId}`).expect(200)).body.status).toBe('completed');

    const sent = await ownerQuery<{ lead_id: string; body: string; status: string }>('SELECT lead_id, body, status FROM messages WHERE campaign_id = $1 ORDER BY body', [campaignId]);
    expect(sent).toEqual([
      { lead_id: leadIds[0], body: 'Hi Omar, our new launch opens Saturday.', status: 'sent' },
      { lead_id: leadIds[1], body: 'Hi Sara, our new launch opens Saturday.', status: 'sent' },
    ]);
    const timeline = (await manager.get(`/api/v1/leads/${leadIds[0]}/timeline`).expect(200)).body.data;
    expect(timeline[0]).toMatchObject({ type: 'whatsapp', summary: 'WhatsApp campaign: Saturday launch' });
    await manager.post(`/api/v1/message-campaigns/${campaignId}/cancel`).expect(409);
  });

  it('a draft or waiting campaign can be cancelled and is not sent', async () => {
    const draft = (await manager.post('/api/v1/message-campaigns').send({ name: 'Never sent', channel: 'whatsapp', templateId, audienceFilter: { sourceId } }).expect(201)).body.id;
    expect((await manager.post(`/api/v1/message-campaigns/${draft}/cancel`).expect(200)).body.status).toBe('cancelled');
    const list = (await director.get('/api/v1/message-campaigns?status=cancelled').expect(200)).body.data;
    expect(list.map((c: { id: string }) => c.id)).toContain(draft);
  });
});
