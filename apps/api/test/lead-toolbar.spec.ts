import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { QueueService } from '../src/core/queue/queue.service';
import { createTestApp, ownerQuery, signIn, testStorage, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

const SOURCE_META_A = 'a1000000-0000-0000-0000-000000000001';
const FEATURES = {
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

// Lead page toolbar (stakeholder update 2026-10-17): Show Lead Counts, Calendar / Date Range, Manage Columns,
// Export Leads and Export Tracker.
describe('lead page toolbar', () => {
  let app: INestApplication;
  let admin: Client;
  let ali: Client;
  const ids: string[] = [];

  const features = (value: Partial<typeof FEATURES>) => admin.put('/api/v1/settings/leads.features').send({ value: { ...FEATURES, ...value } }).expect(200);

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signIn(app, USERS.adminA);
    ali = await signIn(app, USERS.aliA);
    for (const n of [1, 2, 3]) {
      const lead = await admin.post('/api/v1/leads').send({ fullName: `Toolbar Lead ${n}`, phonePrimary: `+97155888000${n}`, email: `toolbar${n}@x.ae`, sourceId: SOURCE_META_A, ownerUserId: USERS.aliA.id }).expect(201);
      ids.push(lead.body.id);
    }
  });

  afterAll(async () => {
    await features({});
    await app.close();
  });

  it('Show Lead Counts: the four statuses with zeros, the same filters as the list, regardless of the status tab', async () => {
    const res = await admin.get('/api/v1/leads/status-counts?q=Toolbar%20Lead&tab=hot').expect(200);
    expect(res.body.data.map((c: { key: string }) => c.key)).toEqual(['hot', 'warm', 'cold', 'sale_done']);
    expect(Object.fromEntries(res.body.data.map((c: { key: string; count: number }) => [c.key, c.count]))).toEqual({ hot: 0, warm: 3, cold: 0, sale_done: 0 });
    const mine = await ali.get('/api/v1/leads/status-counts?q=Toolbar%20Lead').expect(200);
    expect(mine.body.data.find((c: { key: string }) => c.key === 'warm').count).toBe(3);
  });

  it('Calendar / Date Range: the chosen date field, end date included', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const created = await admin.get(`/api/v1/leads?q=Toolbar%20Lead&dateField=created&dateFrom=${today}&dateTo=${tomorrow}&total=true`).expect(200);
    expect(created.body.page.total).toBe(3);
    const later = await admin.get(`/api/v1/leads?q=Toolbar%20Lead&dateField=created&dateFrom=${tomorrow}&total=true`).expect(200);
    expect(later.body.page.total).toBe(0);
    const sale = await admin.get(`/api/v1/leads?q=Toolbar%20Lead&dateField=sale_done&dateFrom=2020-01-01&total=true`).expect(200);
    expect(sale.body.page.total).toBe(0);
    await admin.get('/api/v1/leads?dateField=birthday').expect(400);
    // The latest move between owners is in the list rows (Assigned From, Reassigned By, Reassigned At).
    expect(created.body.data[0].lastAssignment).toMatchObject({ method: 'manual', fromUserId: null, toUserId: USERS.aliA.id, byUserId: USERS.adminA.id, at: expect.any(String) });
  });

  it('Manage Columns: saved per user and list; Reset to Default removes the choice', async () => {
    expect((await ali.get('/api/v1/me/list-columns/leads').expect(200)).body).toEqual({ columns: null });
    await ali.put('/api/v1/me/list-columns/leads').send({ columns: ['name', 'stage', 'substatus', 'assignedFrom'] }).expect(200);
    expect((await ali.get('/api/v1/me/list-columns/leads').expect(200)).body.columns).toEqual(['name', 'stage', 'substatus', 'assignedFrom']);
    expect((await admin.get('/api/v1/me/list-columns/leads').expect(200)).body.columns).toBeNull();
    await ali.put('/api/v1/me/list-columns/leads').send({ columns: ['name', 'name'] }).expect(400);
    await ali.put('/api/v1/me/list-columns/leads').send({ columns: [] }).expect(400);
    await ali.get('/api/v1/me/list-columns/invoices').expect(404);
    await ali.delete('/api/v1/me/list-columns/leads').expect(204);
    expect((await ali.get('/api/v1/me/list-columns/leads').expect(200)).body.columns).toBeNull();
  });

  it('Export Leads: the switch and the permission are checked; the file has the chosen columns in order; the tracker lists it', async () => {
    const body = { scope: 'selected', leadIds: ids.slice(0, 2), columns: ['name', 'phone', 'stage', 'agent'] };
    const off = await admin.post('/api/v1/lead-exports').send(body).expect(403);
    expect(off.body.code).toBe('EXPORT_DISABLED');
    await features({ export_leads: true });
    await ali.post('/api/v1/lead-exports').send(body).expect(403);
    await admin.post('/api/v1/lead-exports').send({ ...body, columns: ['name', 'salary'] }).expect(400);
    await admin.post('/api/v1/lead-exports').send({ scope: 'filtered', filters: { password: 'x' }, columns: ['name'] }).expect(400);

    const queued = await admin.post('/api/v1/lead-exports').send(body).expect(202);
    expect(queued.body).toMatchObject({ status: 'queued', scope: 'selected', columns: ['name', 'phone', 'stage', 'agent'], exportId: expect.stringMatching(/^EX-/) });
    await app.get(QueueService).drain('report-export');

    const tracker = await admin.get('/api/v1/lead-exports').expect(200);
    const row = tracker.body.data.find((e: { id: string }) => e.id === queued.body.id);
    expect(row).toMatchObject({ status: 'ready', recordCount: 2, downloadCount: 0, filters: { selectedLeads: 2 }, fileName: expect.stringMatching(/\.xlsx$/) });
    const link = await admin.post(`/api/v1/lead-exports/${queued.body.id}/download`).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await testStorage.read(link.body.url.replace('memory://download/', ''))) as never);
    const sheet = wb.getWorksheet('Leads')!;
    expect((sheet.getRow(1).values as string[]).slice(1)).toEqual(['Name', 'Phone', 'Status', 'Assigned To']);
    expect(sheet.rowCount).toBe(3);
    expect((sheet.getRow(2).values as string[]).slice(1)).toEqual([expect.stringMatching(/^Toolbar Lead/), expect.stringMatching(/^\+9715588800/), 'Warm', 'Ali']);
    expect((await admin.get('/api/v1/lead-exports').expect(200)).body.data.find((e: { id: string }) => e.id === queued.body.id).downloadCount).toBe(1);

    // An agent sees only their own exports; a ready export cannot be retried.
    expect((await ali.get('/api/v1/lead-exports').expect(200)).body.data).toEqual([]);
    await admin.post(`/api/v1/lead-exports/${queued.body.id}/retry`).expect(409);

    // Downloads are checked again: export switched off, then expired.
    await features({});
    await admin.post(`/api/v1/lead-exports/${queued.body.id}/download`).expect(403);
    await features({ export_leads: true });
    await ownerQuery(`UPDATE export_logs SET expires_at = now() - interval '1 day' WHERE id = $1`, [queued.body.id]);
    const expired = await admin.post(`/api/v1/lead-exports/${queued.body.id}/download`).expect(410);
    expect(expired.body.code).toBe('EXPORT_EXPIRED');
    expect((await admin.get('/api/v1/lead-exports').expect(200)).body.data.find((e: { id: string }) => e.id === queued.body.id).status).toBe('expired');
  });

  it('All filtered leads with contact masking for hidden roles', async () => {
    await features({ export_leads: true, hide_contact_info: { enabled: true, role_keys: ['admin'] } });
    const queued = await admin.post('/api/v1/lead-exports').send({ scope: 'filtered', filters: { q: 'Toolbar Lead', tab: 'all' }, columns: ['name', 'phone', 'email'] }).expect(202);
    await app.get(QueueService).drain('report-export');
    const link = await admin.post(`/api/v1/lead-exports/${queued.body.id}/download`).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await testStorage.read(link.body.url.replace('memory://download/', ''))) as never);
    const sheet = wb.getWorksheet('Leads')!;
    expect(sheet.rowCount).toBe(4);
    expect(String(sheet.getRow(2).getCell(2).value)).toContain('•');
    expect(String(sheet.getRow(2).getCell(3).value)).toMatch(/^t•••@x\.ae$/);
    await features({});
  });
});
