import { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { QueueService } from '../src/core/queue/queue.service';
import { CALENDAR_SYNC, CalendarChange, CalendarSyncProvider } from '../src/modules/calendar/adapters/calendar-sync';
import { createTestApp, ownerQuery, signIn, TENANT_A, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

const APP_SECRET = 'test-meta-app-secret';
process.env.META_APP_SECRET = APP_SECRET;
process.env.META_VERIFY_TOKEN = 'test-verify-token';

/** Calendar changes the "outside" calendar reports on the next sync. */
class FakeCalendarSync implements CalendarSyncProvider {
  next: CalendarChange[] = [];
  cursors: (string | undefined)[] = [];
  async changes(_account: unknown, cursor?: string) {
    this.cursors.push(cursor);
    const changes = this.next;
    this.next = [];
    return { changes, cursor: `cursor-${this.cursors.length}` };
  }
}

// Leads and updates pushed by other systems (SRS §11.1–11.4, §5.1–5.6, §3.13) in tenant A: the general webhook,
// property portals and their lead emails, the WhatsApp webhook and calendar push notifications.
describe('inbound webhooks', () => {
  let app: INestApplication;
  let queue: QueueService;
  let admin: Client;
  let agent: Client;
  let sourceId: string;
  const calendar = new FakeCalendarSync();
  const server = () => app.getHttpServer();
  const sign = (raw: string, secret: string) => createHmac('sha256', secret).update(raw).digest('hex');
  const leadNamed = async (name: string) => (await admin.get(`/api/v1/leads?q=${encodeURIComponent(name)}`).expect(200)).body.data as { id: string; phonePrimary: string; email: string; sourceId: string; latestNote: string | null }[];

  beforeAll(async () => {
    app = await createTestApp((b) => b.overrideProvider(CALENDAR_SYNC).useValue(calendar));
    queue = app.get(QueueService);
    admin = await signIn(app, USERS.adminA);
    agent = await signIn(app, USERS.aliA);
    sourceId = (await admin.post('/api/v1/lead-sources').send({ type: 'website', name: 'Website form (webhook)' }).expect(201)).body.id;
  });

  afterAll(async () => {
    // Other test files use tenant A: leave no extra connected accounts behind.
    await ownerQuery(`UPDATE integrations SET status = 'disconnected' WHERE tenant_id = $1 AND provider IN ('whatsapp_cloud', 'google_workspace')`, [TENANT_A]);
    await app.close();
  });

  describe('general webhook (SRS §11.2)', () => {
    let source: { integrationId: string; inboundUrl: string; secret: string };
    const send = (path: string, body: object, secret?: string, headers: Record<string, string> = {}) => {
      const raw = JSON.stringify(body);
      const r = request(server()).post(path).set('Content-Type', 'application/json');
      for (const [k, v] of Object.entries(headers)) r.set(k, v);
      if (secret) r.set('X-Signature', `sha256=${sign(raw, secret)}`);
      return r.send(raw);
    };

    it('only settings.manage creates one; fields must map to CRM fields and include a phone or email', async () => {
      await agent.post('/api/v1/webhook-sources').send({ name: 'x', sourceId, fieldMapping: { phonePrimary: 'phone' } }).expect(403);
      const unknown = await admin.post('/api/v1/webhook-sources').send({ name: 'Sheet', sourceId, fieldMapping: { nickname: 'n', phonePrimary: 'p' } }).expect(400);
      expect(unknown.body.errors[0].field).toBe('fieldMapping.nickname');
      const noContact = await admin.post('/api/v1/webhook-sources').send({ name: 'Sheet', sourceId, fieldMapping: { fullName: 'name' } }).expect(400);
      expect(noContact.body.errors[0]).toEqual({ field: 'fieldMapping', message: 'map at least the phone or the email' });
      await admin.post('/api/v1/webhook-sources').send({ name: 'Sheet', sourceId: '00000000-0000-4000-8000-000000000000', fieldMapping: { email: 'e' } }).expect(400);

      const created = await admin
        .post('/api/v1/webhook-sources')
        .send({ name: 'Google Sheet: Creek leads', sourceId, fieldMapping: { fullName: 'name', phonePrimary: 'contact.mobile', email: 'email', project: 'interested_in' } })
        .expect(201);
      expect(created.body).toMatchObject({ name: 'Google Sheet: Creek leads', sourceId, inboundUrl: expect.stringMatching(/^http:\/\/localhost:4000\/api\/v1\/webhooks\/inbound\/whk_/), secret: expect.stringMatching(/^whsec_/) });
      source = created.body;
      const listed = (await admin.get('/api/v1/integrations').expect(200)).body.data.find((i: { id: string }) => i.id === source.integrationId);
      expect(listed).toMatchObject({ provider: 'webhook', status: 'connected', accountLabel: 'Google Sheet: Creek leads', settings: { inboundUrl: source.inboundUrl, sourceId } });
      expect(JSON.stringify(listed)).not.toContain(source.secret);
    });

    it('a signed request becomes a lead through the mapping; unsigned or unknown links are refused; repeats are stored once', async () => {
      const path = new URL(source.inboundUrl).pathname;
      const body = { name: 'Hana Webhook', contact: { mobile: '+971 50 700 1001' }, email: 'Hana@Example.ae', interested_in: 'Creek Vista', utm_campaign: 'sheet-oct' };
      await send(path, body).expect(401);
      await send(path, body, 'whsec_wrong').expect(401);
      await send('/api/v1/webhooks/inbound/whk_unknown', body, source.secret).expect(404);
      expect((await send(path, body, source.secret).expect(200)).body).toEqual({ received: true });
      await send(path, body, source.secret).expect(200);
      expect(await queue.drain('lead-intake')).toBe(1);

      const [lead] = await leadNamed('Hana Webhook');
      expect(lead).toMatchObject({ phonePrimary: '+971507001001', email: 'hana@example.ae', sourceId, latestNote: 'Project: Creek Vista' });
      const inquiry = (await admin.get(`/api/v1/leads/${lead!.id}/inquiries`).expect(200)).body.data[0];
      expect(inquiry).toMatchObject({ externalCampaignId: 'sheet-oct', formAnswers: { 'contact.mobile': '+971 50 700 1001', interested_in: 'Creek Vista' } });
    });

    it('the mapping can be changed; a lead without phone or email fails at once with the reason', async () => {
      const updated = await admin.put(`/api/v1/webhook-sources/${source.integrationId}/mapping`).send({ fieldMapping: { fullName: 'client', phonePrimary: 'tel' } }).expect(200);
      expect(updated.body).toMatchObject({ fieldMapping: { fullName: 'client', phonePrimary: 'tel' } });
      expect(updated.body.secret).toBeUndefined();
      await admin.put(`/api/v1/webhook-sources/${source.integrationId}/mapping`).send({ fieldMapping: { nickname: 'x' } }).expect(400);

      const path = new URL(source.inboundUrl).pathname;
      await send(path, { client: 'Karim Mapped', tel: '00971507001002' }, source.secret).expect(200);
      await send(path, { client: 'Nobody Reachable' }, source.secret, { 'X-Event-Id': 'row-77' }).expect(200);
      await queue.drain('lead-intake');
      expect(await leadNamed('Karim Mapped')).toHaveLength(1);
      const failed = (await admin.get(`/api/v1/integrations/${source.integrationId}/events?status=failed`).expect(200)).body.data;
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ externalEventId: `${source.integrationId}:row-77`, attempts: 5, lastError: 'Not imported: a phone or an email is required' });
    });

    it('rotating the secret stops the old one at once', async () => {
      const rotated = await admin.post(`/api/v1/webhook-sources/${source.integrationId}/rotate-secret`).expect(200);
      expect(rotated.body.secret).toMatch(/^whsec_/);
      expect(rotated.body.secret).not.toBe(source.secret);
      const path = new URL(source.inboundUrl).pathname;
      await send(path, { client: 'Old Secret', tel: '+971507001003' }, source.secret).expect(401);
      await send(path, { client: 'New Secret', tel: '+971507001003' }, rotated.body.secret).expect(200);
      await admin.post('/api/v1/webhook-sources/00000000-0000-4000-8000-000000000000/rotate-secret').expect(404);
    });
  });

  describe('property portals (SRS §11.1)', () => {
    const SECRET = 'bayut-shared-secret-123';
    let bayutId: string;
    const portal = (provider: string, body: object, secret?: string) => request(server()).post(`/api/v1/webhooks/portals/${provider}`).set(secret ? { Authorization: `Bearer ${secret}` } : {}).send(body);

    it('connects with a shared secret, kept out of the database', async () => {
      const short = await admin.post('/api/v1/integrations').send({ provider: 'bayut', settings: { sharedSecret: 'short' } }).expect(400);
      expect(short.body.errors[0].field).toBe('settings.sharedSecret');
      bayutId = (await admin.post('/api/v1/integrations').send({ provider: 'bayut', settings: { sharedSecret: SECRET, accountId: 'AGENCY-9' } }).expect(201)).body.integrationId;
      const row = (await admin.get(`/api/v1/integrations/${bayutId}`).expect(200)).body;
      expect(row).toMatchObject({ provider: 'bayut', status: 'connected', accountLabel: 'Bayut', settings: { accountId: 'AGENCY-9', webhookUrl: 'http://localhost:4000/api/v1/webhooks/portals/bayut' } });
      expect(row.settings.secretHash).toBeUndefined();
      const stored = await ownerQuery<{ settings: string }>(`SELECT settings::text FROM integrations WHERE id = $1`, [bayutId]);
      expect(stored[0]!.settings).not.toContain(SECRET);
    });

    it('a portal lead with the right secret is imported under the portal source; the same lead ID is stored once', async () => {
      const lead = { lead_id: 'BY-1', name: 'Bayut Buyer', phone: '+971507002001', email: 'bb@example.ae', message: 'Interested in 2BR', listing_reference: 'BY-REF-77' };
      await portal('unknown', lead, SECRET).expect(404);
      await portal('bayut', lead).expect(401);
      await portal('bayut', lead, 'not-the-secret-at-all').expect(401);
      await portal('dubizzle', lead, SECRET).expect(401); // the secret belongs to the Bayut account
      await portal('bayut', lead, SECRET).expect(200);
      await portal('bayut', { ...lead, message: 'sent again' }, SECRET).expect(200);
      await queue.drain('lead-intake');
      const [found] = await leadNamed('Bayut Buyer');
      expect(found).toMatchObject({ phonePrimary: '+971507002001', latestNote: 'Interested in 2BR' });
      const source = await ownerQuery<{ name: string; type: string }>(`SELECT name, type FROM lead_sources WHERE id = $1`, [found!.sourceId]);
      expect(source[0]).toEqual({ name: 'Bayut', type: 'bayut' });
      const events = await ownerQuery(`SELECT 1 FROM webhook_events WHERE external_event_id = $1`, [`${bayutId}:BY-1`]);
      expect(events).toHaveLength(1);
    });

    it('settings changes cannot replace the secret hash', async () => {
      await admin.patch(`/api/v1/integrations/${bayutId}`).send({ settings: { secretHash: 'x', note: 'agency 9' } }).expect(200);
      await portal('bayut', { lead_id: 'BY-2', name: 'Second Buyer', phone: '+971507002002' }, SECRET).expect(200);
      await queue.drain('lead-intake');
      expect(await leadNamed('Second Buyer')).toHaveLength(1);
    });
  });

  describe('Google Ads lead forms (SRS §11)', () => {
    const KEY = 'google-ads-form-key-123';
    let googleId: string;
    const googleLead = (body: object) => request(server()).post('/api/v1/webhooks/google-ads').send(body);
    const lead = (leadId: string, name: string, phone: string, key: string = KEY) => ({
      lead_id: leadId,
      api_version: '1.0',
      form_id: 4401,
      campaign_id: 9901,
      google_key: key,
      is_test: false,
      user_column_data: [
        { column_name: 'Full Name', string_value: name, column_id: 'FULL_NAME' },
        { column_name: 'User Phone', string_value: phone, column_id: 'PHONE_NUMBER' },
        { column_name: 'User Email', string_value: 'ga@example.ae', column_id: 'EMAIL' },
        { column_name: 'Preferred community', string_value: 'Dubai Hills' },
      ],
    });

    it('connects with the form key as shared secret and shows the webhook URL for Google Ads', async () => {
      googleId = (await admin.post('/api/v1/integrations').send({ provider: 'google_ads', settings: { sharedSecret: KEY } }).expect(201)).body.integrationId;
      const row = (await admin.get(`/api/v1/integrations/${googleId}`).expect(200)).body;
      expect(row).toMatchObject({ provider: 'google_ads', status: 'connected', accountLabel: 'Google Ads lead forms', settings: { webhookUrl: 'http://localhost:4000/api/v1/webhooks/google-ads' } });
      const stored = await ownerQuery<{ settings: string }>(`SELECT settings::text FROM integrations WHERE id = $1`, [googleId]);
      expect(stored[0]!.settings).not.toContain(KEY);
    });

    it('a lead with the right key becomes a lead under the Google Ads source; the key is not stored; repeats are stored once', async () => {
      await googleLead(lead('GA-1', 'Google Buyer', '+971507009901', 'wrong-key-wrong-key')).expect(401);
      await googleLead({ lead_id: 'GA-1' }).expect(401);
      await googleLead(lead('GA-1', 'Google Buyer', '+971507009901')).expect(200);
      await googleLead(lead('GA-1', 'Google Buyer', '+971507009901')).expect(200);
      await queue.drain('lead-intake');
      const [found] = await leadNamed('Google Buyer');
      expect(found).toMatchObject({ phonePrimary: '+971507009901', email: 'ga@example.ae' });
      const source = await ownerQuery<{ name: string; type: string }>(`SELECT name, type FROM lead_sources WHERE id = $1`, [found!.sourceId]);
      expect(source[0]).toEqual({ name: 'Google Ads lead forms', type: 'google_ads' });
      const events = await ownerQuery<{ payload: string }>(`SELECT payload::text FROM webhook_events WHERE external_event_id = $1`, [`${googleId}:GA-1`]);
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).not.toContain(KEY);
      expect(events[0]!.payload).toContain('Preferred community');
    });
  });

  describe('portal lead emails (SES → SNS)', () => {
    const sns = (message: object, type = 'Notification') => ({
      Type: type,
      MessageId: `sns-${Math.random()}`,
      TopicArn: 'arn:aws:sns:me-central-1:111122223333:lead-emails',
      Message: JSON.stringify(message),
      Timestamp: new Date().toISOString(),
      SubscribeURL: type === 'SubscriptionConfirmation' ? 'https://sns.me-central-1.amazonaws.com/?Action=ConfirmSubscription' : undefined,
    });
    const mail = (messageId: string, to: string) => ({
      notificationType: 'Received',
      mail: { messageId, destination: [to], commonHeaders: { from: ['Property Finder <leads@propertyfinder.ae>'], subject: 'New lead', replyTo: ['Rania <rania@example.ae>'] } },
      receipt: { recipients: [to] },
      content: [
        'From: leads@propertyfinder.ae',
        'Content-Type: multipart/alternative; boundary="b1"',
        '',
        '--b1',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'Name: Rania Email',
        'Phone: +971 50 700 3001',
        'Message: Call me after 5pm=',
        ' please',
        '--b1',
        'Content-Type: text/html',
        '',
        '<p>Name: Rania Email</p>',
        '--b1--',
      ].join('\r\n'),
    });
    const post = (body: object) => request(server()).post('/api/v1/webhooks/email-inbound').set('Content-Type', 'text/plain; charset=UTF-8').send(JSON.stringify(body));

    it('a lead email to the portal connection address becomes a lead; other addresses are ignored', async () => {
      await admin.post('/api/v1/integrations').send({ provider: 'property_finder', settings: { sharedSecret: 'pf-shared-secret-12345', inboundEmail: 'Leads@AlNoor.test' } }).expect(201);
      const clash = await admin.post('/api/v1/integrations').send({ provider: 'dubizzle', settings: { sharedSecret: 'dz-shared-secret-12345', inboundEmail: 'leads@alnoor.test' } }).expect(409);
      expect(clash.body.detail).toMatch(/inbound email/);

      await request(server()).post('/api/v1/webhooks/email-inbound').set('Content-Type', 'text/plain').send('not json').expect(400);
      await post(sns({}, 'SubscriptionConfirmation')).expect(200);
      await post(sns(mail('ses-msg-1', 'leads@alnoor.test'))).expect(200);
      await post(sns(mail('ses-msg-1', 'leads@alnoor.test'))).expect(200);
      await post(sns(mail('ses-msg-2', 'someone@else.test'))).expect(200);
      expect(await queue.drain('lead-intake')).toBe(1);

      const [lead] = await leadNamed('Rania Email');
      expect(lead).toMatchObject({ phonePrimary: '+971507003001', email: 'rania@example.ae', latestNote: 'Call me after 5pm please' });
      const ignored = await ownerQuery<{ status: string; tenant_id: string | null }>(`SELECT status, tenant_id FROM webhook_events WHERE provider = 'ses_inbound' AND external_event_id = 'ses-msg-2'`);
      expect(ignored[0]).toEqual({ status: 'ignored', tenant_id: null });
    });
  });

  describe('WhatsApp webhook (SRS §5.1, §5.4–5.6)', () => {
    let integrationId: string;
    let templateId: string;
    const NUMBER = 'WA-PN-77';
    const hook = (changes: object[], entryId = 'WABA-77', secret = APP_SECRET) => {
      const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: entryId, time: Math.floor(Date.now() / 1000), changes }] });
      return request(server()).post('/api/v1/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', `sha256=${sign(raw, secret)}`).send(raw);
    };
    const inbound = (id: string, from: string, text: string, name = 'Yusuf WA') => ({
      field: 'messages',
      value: { messaging_product: 'whatsapp', metadata: { phone_number_id: NUMBER }, contacts: [{ wa_id: from, profile: { name } }], messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] },
    });
    const status = (id: string, s: string, errors?: object[]) => ({ field: 'messages', value: { metadata: { phone_number_id: NUMBER }, statuses: [{ id, status: s, timestamp: String(Math.floor(Date.now() / 1000)), ...(errors ? { errors } : {}) }] } });

    beforeAll(async () => {
      // The licence check for WhatsApp is covered in messaging.spec; here the number is connected directly.
      const [row] = await ownerQuery<{ id: string }>(
        `INSERT INTO integrations (tenant_id, provider, account_label, external_account_id, status, settings, connected_at)
         VALUES ($1, 'whatsapp_cloud', '+971 4 555 0177', $2, 'connected', '{"phoneNumberId":"WA-PN-77","wabaId":"WABA-77"}', now()) RETURNING id`,
        [TENANT_A, NUMBER],
      );
      integrationId = row!.id;
      const [t] = await ownerQuery<{ id: string }>(
        `INSERT INTO message_templates (tenant_id, channel, name, category, body, status, integration_id, provider_template_id)
         VALUES ($1, 'whatsapp', 'inbound_promo', 'marketing', 'Hi {{first_name}}', 'approved', $2, 'TPL-77') RETURNING id`,
        [TENANT_A, integrationId],
      );
      templateId = t!.id;
    });

    it('Meta verifies the webhook; unsigned posts are refused', async () => {
      const ok = await request(server()).get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=777').expect(200);
      expect(ok.text).toBe('777');
      await request(server()).get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1').expect(400);
      await hook([inbound('wamid.IN-0', '971507004001', 'hi')], 'WABA-77', 'wrong-secret').expect(401);
    });

    it('a message from a new number creates a WhatsApp lead with the conversation; repeats are stored once', async () => {
      await hook([inbound('wamid.IN-1', '971507004001', 'Hi, is the villa available?')]).expect(200);
      await hook([inbound('wamid.IN-1', '971507004001', 'Hi, is the villa available?')]).expect(200);
      expect(await queue.drain('message-status')).toBe(1);
      const [lead] = await leadNamed('Yusuf WA');
      expect(lead).toMatchObject({ phonePrimary: '+971507004001' });
      const source = await ownerQuery<{ type: string }>(`SELECT type FROM lead_sources WHERE id = $1`, [lead!.sourceId]);
      expect(source[0]!.type).toBe('whatsapp');
      const conv = await ownerQuery<{ unread_count: number; last_inbound: boolean }>(`SELECT unread_count, last_inbound_at IS NOT NULL AS last_inbound FROM conversations WHERE integration_id = $1 AND contact_address = '+971507004001'`, [integrationId]);
      expect(conv[0]).toEqual({ unread_count: 1, last_inbound: true });
      const msgs = await ownerQuery<{ direction: string; status: string; body: string }>(`SELECT direction, status, body FROM messages WHERE provider_message_id = 'wamid.IN-1'`);
      expect(msgs).toEqual([{ direction: 'inbound', status: 'received', body: 'Hi, is the villa available?' }]);
      const timeline = (await admin.get(`/api/v1/leads/${lead!.id}/timeline`).expect(200)).body.data.map((a: { summary: string }) => a.summary);
      expect(timeline).toContain('WhatsApp received');
    });

    it('receipts move a campaign message to delivered and read; STOP opts out and marks the recipient', async () => {
      const [lead] = await leadNamed('Yusuf WA');
      const [conv] = await ownerQuery<{ id: string }>(`SELECT id FROM conversations WHERE integration_id = $1 AND contact_address = '+971507004001'`, [integrationId]);
      const [campaign] = await ownerQuery<{ id: string }>(
        `INSERT INTO message_campaigns (tenant_id, name, channel, template_id, integration_id, audience_filter, status, created_by, approved_by, approved_at, started_at)
         VALUES ($1, 'Villa launch', 'whatsapp', $2, $3, '{}', 'sending', $4, $5, now(), now()) RETURNING id`,
        [TENANT_A, templateId, integrationId, USERS.adminA.id, USERS.saraA.id],
      );
      const [out] = await ownerQuery<{ id: string }>(
        `INSERT INTO messages (tenant_id, conversation_id, lead_id, direction, template_id, campaign_id, body, provider_message_id, status, sent_at)
         VALUES ($1, $2, $3, 'outbound', $4, $5, 'Hi Yusuf', 'wamid.OUT-1', 'sent', now()) RETURNING id`,
        [TENANT_A, conv!.id, lead!.id, templateId, campaign!.id],
      );
      await ownerQuery(`INSERT INTO message_campaign_recipients (tenant_id, campaign_id, lead_id, address, status, message_id) VALUES ($1, $2, $3, '+971507004001', 'sent', $4)`, [TENANT_A, campaign!.id, lead!.id, out!.id]);

      await hook([status('wamid.OUT-1', 'delivered')]).expect(200);
      await hook([status('wamid.OUT-1', 'read')]).expect(200);
      await hook([status('wamid.OUT-1', 'delivered')]).expect(200); // late receipt: no step back
      await queue.drain('message-status');
      const after = await ownerQuery<{ status: string; delivered: boolean; read: boolean }>(`SELECT status, delivered_at IS NOT NULL AS delivered, read_at IS NOT NULL AS read FROM messages WHERE id = $1`, [out!.id]);
      expect(after[0]).toEqual({ status: 'read', delivered: true, read: true });
      const recipient = async () => (await ownerQuery<{ status: string }>(`SELECT status FROM message_campaign_recipients WHERE message_id = $1`, [out!.id]))[0]!.status;
      expect(await recipient()).toBe('delivered');

      await hook([inbound('wamid.IN-2', '971507004001', 'STOP')]).expect(200);
      await queue.drain('message-status');
      expect(await recipient()).toBe('opted_out');
      const consents = (await admin.get(`/api/v1/leads/${lead!.id}/consents`).expect(200)).body.data;
      expect(consents[0]).toMatchObject({ channel: 'whatsapp', status: 'opted_out', captureMethod: 'reply' });
    });

    it('a failed receipt records Meta\'s error; template reviews update the template', async () => {
      const [lead] = await leadNamed('Yusuf WA');
      const [conv] = await ownerQuery<{ id: string }>(`SELECT id FROM conversations WHERE integration_id = $1`, [integrationId]);
      await ownerQuery(`INSERT INTO messages (tenant_id, conversation_id, lead_id, direction, body, provider_message_id, status, sent_at) VALUES ($1, $2, $3, 'outbound', 'Hello', 'wamid.OUT-2', 'sent', now())`, [TENANT_A, conv!.id, lead!.id]);
      await hook([status('wamid.OUT-2', 'failed', [{ code: 131026, title: 'Message undeliverable' }])]).expect(200);
      await hook([{ field: 'message_template_status_update', value: { event: 'REJECTED', message_template_id: 'TPL-77', reason: 'INVALID_FORMAT' } }]).expect(200);
      await queue.drain('message-status');
      const failed = await ownerQuery(`SELECT status, error_code, error_message FROM messages WHERE provider_message_id = 'wamid.OUT-2'`);
      expect(failed[0]).toEqual({ status: 'failed', error_code: '131026', error_message: 'Message undeliverable' });
      const template = await ownerQuery<{ status: string }>(`SELECT status FROM message_templates WHERE id = $1`, [templateId]);
      expect(template[0]!.status).toBe('rejected');
    });
  });

  describe('calendar push (SRS §3.13)', () => {
    let meetingId: string;
    let externalId: string;
    const google = (headers: Record<string, string>) => request(server()).post('/api/v1/webhooks/calendar/google').set(headers).send({});

    beforeAll(async () => {
      await ownerQuery(
        `INSERT INTO integrations (tenant_id, provider, scope, user_id, account_label, external_account_id, status, settings, connected_at)
         VALUES ($1, 'google_workspace', 'user', $2, 'ali@gmail.test', 'ali@gmail.test', 'connected', '{"watchChannelId":"CH-ALI","watchToken":"tok-ali-123456"}', now())`,
        [TENANT_A, USERS.aliA.id],
      );
      const meeting = await agent
        .post('/api/v1/meetings')
        .send({ leadId: 'a2000000-0000-0000-0000-000000000001', organizerUserId: USERS.aliA.id, type: 'meeting', channel: 'google_meet', startsAt: '2027-03-10T06:00:00Z', endsAt: '2027-03-10T06:30:00Z', clientTimezone: 'Asia/Dubai', sendConfirmation: false })
        .expect(201);
      meetingId = meeting.body.id;
      externalId = (await ownerQuery<{ external_meeting_id: string }>(`SELECT external_meeting_id FROM meetings WHERE id = $1`, [meetingId]))[0]!.external_meeting_id;
    });

    it('checks the channel; a change moved in Google Calendar moves the meeting and its task', async () => {
      await google({ 'X-Goog-Channel-ID': 'CH-NOPE', 'X-Goog-Channel-Token': 'tok-ali-123456', 'X-Goog-Resource-State': 'exists' }).expect(404);
      await google({ 'X-Goog-Channel-ID': 'CH-ALI', 'X-Goog-Channel-Token': 'wrong', 'X-Goog-Resource-State': 'exists' }).expect(401);
      await google({ 'X-Goog-Channel-ID': 'CH-ALI', 'X-Goog-Channel-Token': 'tok-ali-123456', 'X-Goog-Resource-State': 'sync', 'X-Goog-Message-Number': '1' }).expect(200);
      expect(await queue.drain('calendar-sync')).toBe(0);

      calendar.next = [{ externalMeetingId: externalId, status: 'confirmed', startsAt: new Date('2027-03-10T07:00:00Z'), endsAt: new Date('2027-03-10T07:45:00Z') }];
      await google({ 'X-Goog-Channel-ID': 'CH-ALI', 'X-Goog-Channel-Token': 'tok-ali-123456', 'X-Goog-Resource-State': 'exists', 'X-Goog-Message-Number': '2' }).expect(200);
      expect(await queue.drain('calendar-sync')).toBe(1);
      const moved = (await agent.get(`/api/v1/meetings/${meetingId}`).expect(200)).body;
      expect(moved).toMatchObject({ startsAt: '2027-03-10T07:00:00.000Z', endsAt: '2027-03-10T07:45:00.000Z', status: 'scheduled' });
      const task = await ownerQuery<{ due_at: Date }>(`SELECT due_at FROM tasks WHERE meeting_id = $1`, [meetingId]);
      expect(task[0]!.due_at.toISOString()).toBe('2027-03-10T07:00:00.000Z');
      const saved = await ownerQuery<{ cursor: string }>(`SELECT settings->>'syncCursor' AS cursor FROM integrations WHERE provider = 'google_workspace' AND user_id = $1 AND tenant_id = $2`, [USERS.aliA.id, TENANT_A]);
      expect(saved[0]!.cursor).toBe('cursor-1');
    });

    it('an event deleted in Google Calendar cancels the meeting; the next sync uses the saved cursor', async () => {
      calendar.next = [{ externalMeetingId: externalId, status: 'cancelled' }];
      await google({ 'X-Goog-Channel-ID': 'CH-ALI', 'X-Goog-Channel-Token': 'tok-ali-123456', 'X-Goog-Resource-State': 'exists', 'X-Goog-Message-Number': '3' }).expect(200);
      await queue.drain('calendar-sync');
      expect(calendar.cursors.at(-1)).toBe('cursor-1');
      expect((await agent.get(`/api/v1/meetings/${meetingId}`).expect(200)).body).toMatchObject({ status: 'cancelled', cancelReason: 'Cancelled in Google Calendar' });
    });

    it('Microsoft Graph subscription handshake echoes the validation token', async () => {
      const res = await request(server()).post('/api/v1/webhooks/calendar/microsoft?validationToken=abc%20123').send({}).expect(200);
      expect(res.text).toBe('abc 123');
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      await request(server()).post('/api/v1/webhooks/calendar/microsoft').send({ value: [{ subscriptionId: 'nope', clientState: 'x' }] }).expect(404);
      await request(server()).post('/api/v1/webhooks/calendar/yahoo').send({}).expect(404);
    });
  });
});
