import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { QueueService } from '../src/core/queue/queue.service';
import { emailText, SenderAccount } from '../src/modules/messaging/adapters/channel-gateway';
import { createTestApp, ownerQuery, signIn, TENANT_A, testStorage, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

const SOURCE_META_A = 'a1000000-0000-0000-0000-000000000001';
const PROJECT_BEACHFRONT = 'a4000000-0000-0000-0000-000000000001';
const DEFAULTS = {
  export_leads: false,
  source_update: false,
  dual_ownership: false,
  secondary_owner_notification: false,
  past_date_selection: false,
  hide_contact_info: { enabled: false, role_keys: [] as string[] },
  mandatory_location: false,
  unassigned_communication: false,
  rotation: true,
};

// Global Configuration: lead switches enforced by the API, Dual Lead Ownership, Migration, Watermark, Email.
describe('Global Configuration', () => {
  let app: INestApplication;
  let admin: Client;
  let ali: Client;
  let mira: Client;
  let adminB: Client;

  const features = (value: Partial<typeof DEFAULTS>) => admin.put('/api/v1/settings/leads.features').send({ value: { ...DEFAULTS, ...value } }).expect(200);

  /** Uploads like the browser does: request a link, PUT the bytes (here: into the test storage), confirm. */
  async function upload(client: Client, fileName: string, mimeType: string, body: Buffer, purpose: string): Promise<string> {
    const ticket = await client.post('/api/v1/files/uploads').send({ fileName, mimeType, sizeBytes: body.length, purpose }).expect(201);
    await testStorage.write(ticket.body.uploadUrl.replace('memory://upload/', ''), body, mimeType);
    await client.post(`/api/v1/files/${ticket.body.fileId}/complete`).expect(200);
    return ticket.body.fileId;
  }

  const binary = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signIn(app, USERS.adminA);
    ali = await signIn(app, USERS.aliA);
    mira = await signIn(app, USERS.miraA);
    adminB = await signIn(app, USERS.adminB);
  });

  afterAll(async () => {
    await features({});
    await app.close();
  });

  describe('lead switches', () => {
    it('every user reads the client policy; it follows the saved switches', async () => {
      expect((await ali.get('/api/v1/client-policy').expect(200)).body).toMatchObject({ allowCopyPaste: true, exportLeads: false, defaultCountry: 'AE', defaultCurrency: 'AED' });
      await features({ export_leads: true });
      expect((await ali.get('/api/v1/client-policy').expect(200)).body.exportLeads).toBe(true);
      await features({});
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
      await features({});
    });

    it('messages to unassigned leads are refused unless switched on', async () => {
      await features({ rotation: false });
      const lead = (await admin.post('/api/v1/leads').send({ fullName: 'Nobody Owns', phonePrimary: '+971556660003', sourceId: SOURCE_META_A }).expect(201)).body;
      expect(lead.ownerUserId).toBeNull();
      await features({});
      // The Admin role has no messages.send by default; give it for this check (agents never see unassigned leads).
      const grant = `INSERT INTO role_permissions (tenant_id, role_id, permission_key) SELECT tenant_id, id, 'messages.send' FROM roles WHERE tenant_id = $1 AND key = 'admin' ON CONFLICT DO NOTHING`;
      await ownerQuery(grant, [TENANT_A]);
      const res = await admin.post(`/api/v1/leads/${lead.id}/messages`).send({ channel: 'whatsapp', body: 'Hello' }).expect(403);
      expect(res.body.code).toBe('UNASSIGNED_LEAD');
      await ownerQuery(`DELETE FROM role_permissions WHERE tenant_id = $1 AND permission_key = 'messages.send' AND role_id = (SELECT id FROM roles WHERE tenant_id = $1 AND key = 'admin')`, [TENANT_A]);
    });
  });

  it('Dual Lead Ownership: a secondary owner (never the owner) sees and edits the lead and is notified', async () => {
    const lead = (await admin.post('/api/v1/leads').send({ fullName: 'Two Owners', phonePrimary: '+971556660010', sourceId: SOURCE_META_A, ownerUserId: USERS.aliA.id }).expect(201)).body;
    const off = await admin.post(`/api/v1/leads/${lead.id}/secondary-owner`).send({ userId: USERS.miraA.id }).expect(403);
    expect(off.body.detail).toContain('Dual Lead Ownership');
    await features({ dual_ownership: true, secondary_owner_notification: true });
    await admin.post(`/api/v1/leads/${lead.id}/secondary-owner`).send({ userId: USERS.aliA.id }).expect(400);
    const set = await admin.post(`/api/v1/leads/${lead.id}/secondary-owner`).send({ userId: USERS.miraA.id }).expect(200);
    expect(set.body.secondaryOwnerUserId).toBe(USERS.miraA.id);
    const seen = await mira.get(`/api/v1/leads/${lead.id}`).expect(200);
    expect(seen.body.access).toBe('edit');
    await mira.post(`/api/v1/leads/${lead.id}/notes`).send({ body: 'Co-owner note' }).expect(201);

    const stages = (await admin.get('/api/v1/lead-stages').expect(200)).body.data as { key: string; id: string }[];
    await ali.post(`/api/v1/leads/${lead.id}/stage`).send({ stageId: stages.find((s) => s.key === 'hot')!.id, nextFollowUpAt: '2030-01-01T09:00:00Z' }).expect(200);
    const notes = await mira.get('/api/v1/notifications?limit=10').expect(200);
    expect(notes.body.data.map((n: { title: string }) => n.title)).toEqual(expect.arrayContaining(['You are now the secondary owner', 'Lead status changed']));
    await admin.post(`/api/v1/leads/${lead.id}/secondary-owner`).send({ userId: null }).expect(200);
    await mira.get(`/api/v1/leads/${lead.id}`).expect(404);
    await features({});
  });

  it('Migration: template, status / substatus / owner / project / created date, skip or update known leads, batches', async () => {
    const template = await admin.get('/api/v1/leads/imports/template').buffer(true).parse(binary as never).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(template.body as never);
    expect((wb.getWorksheet('Leads')!.getRow(1).values as string[]).slice(1)).toEqual([
      'Name', 'Country Code', 'Phone', 'Email', 'Source', 'Owner', 'Status', 'Substatus', 'Project', 'Budget Min', 'Budget Max', 'Currency', 'Notes', 'Created Date',
    ]);
    expect(wb.getWorksheet('Statuses')!.rowCount).toBeGreaterThan(10);

    const known = (await admin.post('/api/v1/leads').send({ fullName: 'Old Name', phonePrimary: '+971556660020', sourceId: SOURCE_META_A }).expect(201)).body;
    const project = (await admin.get(`/api/v1/projects/${PROJECT_BEACHFRONT}`).expect(200)).body.name as string;
    const csv = [
      'Name,Country Code,Phone,Status,Substatus,Owner,Project,Created Date',
      `Migrated Hot,AE,+971556660021,Hot,Zoom Schedule,ali@a.ae,${project},2025-03-01`,
      'Migrated Cold,IN,+971556660022,Cold,Not Interested,,,',
      'New Name,AE,+971556660020,Warm,,,,',
      'Bad Status,AE,+971556660023,Lukewarm,,,,',
      'Cold No Sub,AE,+971556660024,Cold,,,,',
    ].join('\n');
    const fileId = await upload(admin, 'migration.csv', 'text/csv', Buffer.from(csv), 'import');
    const started = await admin.post('/api/v1/leads/imports').send({ fileId, sourceId: SOURCE_META_A, duplicateMode: 'skip' }).expect(201);
    expect(started.body.mapping).toMatchObject({ status: 'Status', substatus: 'Substatus', owner: 'Owner', project: 'Project', createdDate: 'Created Date' });
    await admin.post(`/api/v1/leads/imports/${started.body.id}/confirm`).expect(202);
    await app.get(QueueService).drain('lead-import');
    const done = (await admin.get(`/api/v1/leads/imports/${started.body.id}`).expect(200)).body;
    expect(done).toMatchObject({ status: 'completed', duplicateMode: 'skip', rowsImported: 2, rowsSkipped: 1, rowsRejected: 2, batchId: expect.stringMatching(/^B-/) });

    const [hot] = await ownerQuery<{ owner_user_id: string; created_at: Date; stage: string; sub: string; projects: number }>(
      `SELECT l.owner_user_id, l.created_at, s.key AS stage, x.name AS sub, (SELECT count(*)::int FROM lead_projects p WHERE p.lead_id = l.id) AS projects
       FROM leads l JOIN lead_stages s ON s.id = l.stage_id LEFT JOIN lead_substatuses x ON x.id = l.substatus_id WHERE l.phone_primary = '+971556660021'`,
    );
    expect(hot).toMatchObject({ owner_user_id: USERS.aliA.id, stage: 'hot', sub: 'Zoom Schedule', projects: 1 });
    expect(hot!.created_at.toISOString().slice(0, 10)).toBe('2025-03-01');
    expect((await admin.get(`/api/v1/leads/${known.id}`).expect(200)).body.fullName).toBe('Old Name');

    // The same file again with "update": nothing new, the known leads take the file's values.
    const again = await admin.post('/api/v1/leads/imports').send({ fileId, sourceId: SOURCE_META_A, duplicateMode: 'update' }).expect(201);
    await admin.post(`/api/v1/leads/imports/${again.body.id}/confirm`).expect(202);
    await app.get(QueueService).drain('lead-import');
    const updated = (await admin.get(`/api/v1/leads/imports/${again.body.id}`).expect(200)).body;
    expect(updated).toMatchObject({ status: 'completed', rowsImported: 0, rowsUpdated: 3, rowsRejected: 2 });
    expect((await admin.get(`/api/v1/leads/${known.id}`).expect(200)).body.fullName).toBe('New Name');

    const list = await admin.get('/api/v1/leads/imports').expect(200);
    expect(list.body.data.slice(0, 2).map((b: { id: string }) => b.id)).toEqual([again.body.id, started.body.id]);
    await admin.post(`/api/v1/leads/imports/${again.body.id}/retry`).expect(409);
  });

  it('Watermark: images attached as project images are stamped on download; the original stays', async () => {
    const original = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#3366aa' } }).png().toBuffer();
    const fileId = await upload(admin, 'view.png', 'image/png', original, 'project_media');
    await admin.post(`/api/v1/projects/${PROJECT_BEACHFRONT}/attachments`).send({ fileId, category: 'image' }).expect(201);
    const plain = (await admin.get(`/api/v1/files/${fileId}/download`).expect(200)).body.url as string;
    expect(plain).not.toContain('/derived/');

    const general = (await admin.get('/api/v1/settings/general.preferences').expect(200)).body.value;
    await admin
      .put('/api/v1/settings/general.preferences')
      .send({ value: { ...general, watermark: { enabled: true, kind: 'text', text: 'Al Noor Realty', opacity: 40, position: 'center', apply_to: ['images'] } } })
      .expect(200);
    const stamped = (await ali.get(`/api/v1/files/${fileId}/download`).expect(200)).body.url as string;
    expect(stamped).toContain('/derived/');
    const body = await testStorage.read(stamped.replace('memory://download/', ''));
    expect(body.equals(original)).toBe(false);
    expect((await sharp(body).metadata()).width).toBe(400);
    // The second download serves the stored copy (same watermark version).
    expect((await admin.get(`/api/v1/files/${fileId}/download`).expect(200)).body.url).toBe(stamped);
    await admin.put('/api/v1/settings/general.preferences').send({ value: general }).expect(200);
  });

  it('Email Configuration: reply-to and signature are checked and added to every email', async () => {
    const bad = await adminB.post('/api/v1/integrations').send({ provider: 'email_ses', settings: { fromAddress: 'crm@other.ae', replyTo: 'not-an-email' } }).expect(400);
    expect(bad.body.errors[0].field).toBe('settings.replyTo');
    const created = await adminB.post('/api/v1/integrations').send({ provider: 'email_ses', settings: { fromAddress: 'crm@other.ae', replyTo: 'Sales@Other.ae' } }).expect(201);
    const id = created.body.integrationId as string;
    const saved = await adminB.patch(`/api/v1/integrations/${id}`).send({ settings: { signature: 'Kind regards,\nSales team' } }).expect(200);
    expect(saved.body.settings).toMatchObject({ replyTo: 'sales@other.ae', signature: 'Kind regards,\nSales team' });
    await adminB.patch(`/api/v1/integrations/${id}`).send({ settings: { replyTo: 'nope' } }).expect(400);
    const account = { provider: 'email_ses', settings: saved.body.settings } as SenderAccount;
    expect(emailText(account, { to: 'x@y.ae', body: 'Hello' })).toBe('Hello\n\n-- \nKind regards,\nSales team');
    await adminB.delete(`/api/v1/integrations/${id}`).expect(204);
  });
});
