import { INestApplication } from '@nestjs/common';
import { QueueService } from '../src/core/queue/queue.service';
import { createTestApp, ownerQuery, signIn, TENANT_B, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

// WhatsApp and email (SRS §5.1–5.6), in tenant B with MESSAGING_MODE=simulate: connections, templates,
// one-to-one messages on the lead, the 24-hour WhatsApp window, opt-out and data scope.
describe('messaging', () => {
  let app: INestApplication;
  let queue: QueueService;
  let admin: Client;
  let agent: Client;
  let otherAgent: Client;
  let agentA: Client;
  let leadId: string;
  let templateId: string;
  const AGENT = { id: 'b0000000-0000-0000-0000-0000000000e1', email: 'msg.agent@b.ae', tenant: TENANT_B };
  const OTHER = { id: 'b0000000-0000-0000-0000-0000000000e2', email: 'msg.other@b.ae', tenant: TENANT_B };

  beforeAll(async () => {
    app = await createTestApp();
    queue = app.get(QueueService);
    for (const u of [AGENT, OTHER]) {
      await ownerQuery(
        `INSERT INTO users (id, tenant_id, email, full_name, role_id, status)
         SELECT $1, $2, $3, $4, id, 'active' FROM roles WHERE tenant_id = $2 AND key = 'sales_agent' ON CONFLICT (id) DO NOTHING`,
        [u.id, u.tenant, u.email, u.email.split('@')[0]],
      );
    }
    admin = await signIn(app, USERS.adminB);
    agent = await signIn(app, AGENT);
    otherAgent = await signIn(app, OTHER);
    agentA = await signIn(app, USERS.aliA);
    const sourceId = (await admin.post('/api/v1/lead-sources').send({ type: 'website', name: 'Messaging source' }).expect(201)).body.id;
    leadId = (
      await admin.post('/api/v1/leads').send({ fullName: 'Layla Haddad', phonePrimary: '+971501112233', email: 'layla@example.ae', sourceId, ownerUserId: AGENT.id }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('WhatsApp connects only after the licence is verified; email connects with a sender address', async () => {
    // Other test files may have verified tenant B already: start from "pending".
    await ownerQuery(`UPDATE tenants SET verification_status = 'pending', verified_at = NULL WHERE id = $1`, [TENANT_B]);
    const blocked = await admin.post('/api/v1/integrations').send({ provider: 'whatsapp_cloud', settings: { phoneNumberId: '1001', wabaId: '2002' } }).expect(422);
    expect(blocked.body.code).toBe('LICENCE_NOT_VERIFIED');
    await ownerQuery(`UPDATE tenants SET verification_status = 'verified', verified_at = now() WHERE id = $1`, [TENANT_B]);

    const missing = await admin.post('/api/v1/integrations').send({ provider: 'whatsapp_cloud', settings: { phoneNumberId: '1001' } }).expect(400);
    expect(missing.body.errors).toEqual([{ field: 'settings.wabaId', message: 'required' }]);
    const wa = await admin.post('/api/v1/integrations').send({ provider: 'whatsapp_cloud', settings: { phoneNumberId: '1001', wabaId: '2002', displayPhone: '+971 4 555 0100' } }).expect(201);
    expect(wa.body.authorizeUrl).toBeNull();
    await admin.post('/api/v1/integrations').send({ provider: 'email_ses', settings: { fromAddress: 'Sales@Other.ae' } }).expect(201);

    const list = (await admin.get('/api/v1/integrations').expect(200)).body.data;
    expect(list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'whatsapp_cloud', status: 'connected', accountLabel: '+971 4 555 0100' }),
        expect.objectContaining({ provider: 'email_ses', status: 'connected', accountLabel: 'sales@other.ae' }),
      ]),
    );
    expect((await admin.post(`/api/v1/integrations/${wa.body.integrationId}/test`).expect(200)).body.ok).toBe(true);
  });

  it('only settings.manage creates templates; placeholders must be declared; submit approves (simulated Meta review)', async () => {
    await agent.post('/api/v1/message-templates').send({ channel: 'whatsapp', name: 'x', category: 'utility', body: 'Hi' }).expect(403);
    const undeclared = await admin.post('/api/v1/message-templates').send({ channel: 'whatsapp', name: 'follow_up', category: 'utility', body: 'Hi {{first_name}}' }).expect(400);
    expect(undeclared.body.errors[0].message).toMatch(/first_name/);
    const noSubject = await admin.post('/api/v1/message-templates').send({ channel: 'email', name: 'brochure', category: 'marketing', body: 'Hi' }).expect(400);
    expect(noSubject.body.errors[0].field).toBe('subject');

    const created = await admin
      .post('/api/v1/message-templates')
      .send({ channel: 'whatsapp', name: 'follow_up', category: 'utility', body: 'Hi {{first_name}}, the {{project}} brochure is ready.', variables: [{ name: 'first_name' }, { name: 'project', example: 'Beachfront' }] })
      .expect(201);
    expect(created.body.status).toBe('draft');
    templateId = created.body.id;
    await admin.post('/api/v1/message-templates').send({ channel: 'whatsapp', name: 'follow_up', category: 'utility', body: 'Dup' }).expect(409);

    const submitted = await admin.post(`/api/v1/message-templates/${templateId}/submit`).expect(200);
    expect(submitted.body.status).toBe('approved');
    const locked = await admin.patch(`/api/v1/message-templates/${templateId}`).send({ body: 'Changed' }).expect(409);
    expect(locked.body.code).toBe('TEMPLATE_LOCKED');
    expect((await agent.get('/api/v1/message-templates?status=approved').expect(200)).body.data.map((t: { id: string }) => t.id)).toContain(templateId);
    // Admins manage templates without sending messages themselves (SRS §13): they can read them too.
    expect((await admin.get('/api/v1/message-templates').expect(200)).body.data.map((t: { id: string }) => t.id)).toContain(templateId);
    await agentA.get(`/api/v1/message-templates/${templateId}`).expect(404);
  });

  it('WhatsApp outside the 24-hour window needs an approved template with every value; the send is queued then sent', async () => {
    const free = await agent.post(`/api/v1/leads/${leadId}/messages`).send({ channel: 'whatsapp', body: 'Hello' }).expect(422);
    expect(free.body.code).toBe('TEMPLATE_REQUIRED');
    const missing = await agent.post(`/api/v1/leads/${leadId}/messages`).send({ channel: 'whatsapp', templateId, variables: { first_name: 'Layla' } }).expect(400);
    expect(missing.body.errors).toEqual([{ field: 'variables.project', message: 'a value is required' }]);

    const queued = await agent.post(`/api/v1/leads/${leadId}/messages`).send({ channel: 'whatsapp', templateId, variables: { first_name: 'Layla', project: 'Beachfront' } }).expect(202);
    expect(queued.body).toMatchObject({ direction: 'outbound', status: 'queued', templateId, body: 'Hi Layla, the Beachfront brochure is ready.', sentBy: AGENT.id });
    await queue.drain('send-message');

    const conversations = (await agent.get(`/api/v1/conversations?leadId=${leadId}`).expect(200)).body.data;
    expect(conversations).toEqual([expect.objectContaining({ leadId, channel: 'whatsapp', contactAddress: '+971501112233', replyWindowOpen: false })]);
    const msgs = (await agent.get(`/api/v1/conversations/${conversations[0].id}/messages`).expect(200)).body.data;
    expect(msgs[0]).toMatchObject({ id: queued.body.id, status: 'sent' });
    await agent.post(`/api/v1/conversations/${conversations[0].id}/read`).expect(204);

    const timeline = (await agent.get(`/api/v1/leads/${leadId}/timeline`).expect(200)).body.data;
    expect(timeline[0]).toMatchObject({ type: 'whatsapp', summary: 'WhatsApp sent: follow_up', links: { messageId: queued.body.id } });
  });

  it('a message by the owner counts as acting on the lead (first response recorded)', async () => {
    const [lead] = await ownerQuery<{ response_due_at: Date | null; first_response_at: Date | null }>('SELECT response_due_at, first_response_at FROM leads WHERE id = $1', [leadId]);
    expect(lead).toMatchObject({ response_due_at: null, first_response_at: expect.any(Date) });
  });

  it('email needs a subject and text; it is sent from the company sender', async () => {
    const bad = await agent.post(`/api/v1/leads/${leadId}/messages`).send({ channel: 'email', body: 'Brochure attached' }).expect(400);
    expect(bad.body.errors[0].field).toBe('subject');
    const sent = await agent.post(`/api/v1/leads/${leadId}/messages`).send({ channel: 'email', subject: 'Beachfront brochure', body: 'Here it is.' }).expect(202);
    await queue.drain('send-message');
    const [row] = await ownerQuery<{ status: string; provider_message_id: string }>('SELECT status, provider_message_id FROM messages WHERE id = $1', [sent.body.id]);
    expect(row).toMatchObject({ status: 'sent', provider_message_id: expect.stringMatching(/^sim_/) });
  });

  it('a provider failure marks the message failed with the reason', async () => {
    const sourceId = (await admin.get('/api/v1/lead-sources').expect(200)).body.data.find((s: { name: string }) => s.name === 'Messaging source').id;
    const failing = (await admin.post('/api/v1/leads').send({ fullName: 'Bounce', email: 'fail@example.ae', sourceId, ownerUserId: AGENT.id }).expect(201)).body.id;
    const sent = await agent.post(`/api/v1/leads/${failing}/messages`).send({ channel: 'email', subject: 'Hi', body: 'Test' }).expect(202);
    await queue.drain('send-message');
    const [row] = await ownerQuery<{ status: string; error_message: string }>('SELECT status, error_message FROM messages WHERE id = $1', [sent.body.id]);
    expect(row).toMatchObject({ status: 'failed', error_message: 'Simulated provider error' });
  });

  it('opted-out leads are never messaged; consent history is kept', async () => {
    await agent.post(`/api/v1/leads/${leadId}/consents`).send({ channel: 'whatsapp', status: 'opted_out', captureMethod: 'manual', note: 'Asked on the phone' }).expect(201);
    const refused = await agent.post(`/api/v1/leads/${leadId}/messages`).send({ channel: 'whatsapp', templateId, variables: { first_name: 'L', project: 'P' } }).expect(422);
    expect(refused.body.code).toBe('OPTED_OUT');
    await agent.post(`/api/v1/leads/${leadId}/messages`).send({ channel: 'email', subject: 'Still allowed', body: 'Email is a separate channel.' }).expect(202);

    await agent.post(`/api/v1/leads/${leadId}/consents`).send({ channel: 'whatsapp', status: 'opted_in', captureMethod: 'form' }).expect(201);
    const history = (await agent.get(`/api/v1/leads/${leadId}/consents`).expect(200)).body.data;
    expect(history.map((c: { status: string }) => c.status)).toEqual(['opted_in', 'opted_out']);
  });

  it('conversations follow the lead data scope and stay inside the tenant', async () => {
    expect((await otherAgent.get('/api/v1/conversations').expect(200)).body.data).toEqual([]);
    const id = (await agent.get(`/api/v1/conversations?leadId=${leadId}&channel=whatsapp`).expect(200)).body.data[0].id;
    await otherAgent.get(`/api/v1/conversations/${id}/messages`).expect(404);
    await agentA.get(`/api/v1/conversations/${id}/messages`).expect(404);
    await otherAgent.post(`/api/v1/leads/${leadId}/messages`).send({ channel: 'email', subject: 'x', body: 'y' }).expect(404);
    await admin.get('/api/v1/conversations').expect(403);
  });
});
