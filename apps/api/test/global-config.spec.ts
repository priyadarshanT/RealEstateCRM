import { INestApplication } from '@nestjs/common';
import { createTestApp, ownerQuery, signIn, TENANT_A, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

const SOURCE_META_A = 'a1000000-0000-0000-0000-000000000001';
const DEFAULTS = {
  export_leads: false,
  source_update: false,
  dual_ownership: false,
  secondary_owner_notification: false,
  past_date_selection: false,
  hide_contact_info: { enabled: false, role_keys: [] as string[] },
  mandatory_location: false,
  unassigned_communication: false,
};

// Global Configuration › Leads switches are enforced by the API, not only hidden in the screens.
describe('Global Configuration lead switches', () => {
  let app: INestApplication;
  let admin: Client;
  let ali: Client;

  const features = (value: Partial<typeof DEFAULTS>) => admin.put('/api/v1/settings/leads.features').send({ value: { ...DEFAULTS, ...value } }).expect(200);

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signIn(app, USERS.adminA);
    ali = await signIn(app, USERS.aliA);
  });

  afterAll(async () => {
    await features({});
    await app.close();
  });

  it('every user reads the client policy; it follows the saved switches', async () => {
    expect((await ali.get('/api/v1/client-policy').expect(200)).body).toMatchObject({ allowCopyPaste: true, exportLeads: false, defaultCountry: 'AE', defaultCurrency: 'AED' });
    await features({ export_leads: true });
    expect((await ali.get('/api/v1/client-policy').expect(200)).body.exportLeads).toBe(true);
  });

  it('mandatory location, source update and hidden contact info', async () => {
    await features({ mandatory_location: true });
    const missing = await admin.post('/api/v1/leads').send({ fullName: 'No Country', phonePrimary: '+971556660001', sourceId: SOURCE_META_A, ownerUserId: USERS.aliA.id }).expect(400);
    expect(missing.body.errors[0].field).toBe('countryCode');
    const lead = (await admin.post('/api/v1/leads').send({ fullName: 'With Country', phonePrimary: '+971556660002', email: 'masked@x.ae', countryCode: 'AE', sourceId: SOURCE_META_A, ownerUserId: USERS.aliA.id }).expect(201)).body;

    const other = (await admin.post('/api/v1/lead-sources').send({ type: 'referral', name: 'Global config referral' }).expect(201)).body.id;
    await admin.patch(`/api/v1/leads/${lead.id}`).send({ sourceId: other, version: lead.version }).expect(403);
    await features({ source_update: true });
    const moved = await admin.patch(`/api/v1/leads/${lead.id}`).send({ sourceId: other, version: lead.version }).expect(200);
    expect(moved.body.sourceId).toBe(other);

    await features({ hide_contact_info: { enabled: true, role_keys: ['sales_agent'] } });
    const seen = await ali.get(`/api/v1/leads/${lead.id}`).expect(200);
    expect(seen.body).toMatchObject({ phonePrimary: '+971•••••••02', email: 'm•••@x.ae', contactHidden: true });
    const listed = await ali.get('/api/v1/leads?q=With%20Country').expect(200);
    expect(listed.body.data[0].phonePrimary).toContain('•');
    expect((await admin.get(`/api/v1/leads/${lead.id}`).expect(200)).body.phonePrimary).toBe('+971556660002');
  });

  it('messages to unassigned leads are refused unless switched on', async () => {
    const lead = (await admin.post('/api/v1/leads').send({ fullName: 'Nobody Owns', phonePrimary: '+971556660003', sourceId: SOURCE_META_A }).expect(201)).body;
    if (lead.ownerUserId) return; // an assignment rule picked an owner; nothing to check
    await features({});
    // The Admin role has no messages.send by default; give it for this check (agents never see unassigned leads).
    const grant = `INSERT INTO role_permissions (tenant_id, role_id, permission_key) SELECT tenant_id, id, 'messages.send' FROM roles WHERE tenant_id = $1 AND key = 'admin' ON CONFLICT DO NOTHING`;
    await ownerQuery(grant, [TENANT_A]);
    const res = await admin.post(`/api/v1/leads/${lead.id}/messages`).send({ channel: 'whatsapp', body: 'Hello' }).expect(403);
    expect(res.body.code).toBe('UNASSIGNED_LEAD');
    await ownerQuery(`DELETE FROM role_permissions WHERE tenant_id = $1 AND permission_key = 'messages.send' AND role_id = (SELECT id FROM roles WHERE tenant_id = $1 AND key = 'admin')`, [TENANT_A]);
  });
});
