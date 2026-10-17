import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { QueueService } from '../src/core/queue/queue.service';
import { createTestApp, signIn, testStorage, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

const SOURCE_META_A = 'a1000000-0000-0000-0000-000000000001';

// Stakeholder update 2026-10-17 (follow-up): City on the lead and in the export; assignment history with
// Assigned From (previous agent), Assigned To, who made the move and when, in Manage Columns and on the lead page.
describe('lead city and assignment history', () => {
  let app: INestApplication;
  let admin: Client;
  let ali: Client;
  let mira: Client;
  let reasonId: string;

  const features = (exportLeads: boolean) =>
    admin
      .put('/api/v1/settings/leads.features')
      .send({
        value: {
          export_leads: exportLeads,
          source_update: false,
          dual_ownership: false,
          secondary_owner_notification: false,
          past_date_selection: false,
          hide_contact_info: { enabled: false, role_keys: [] },
          mandatory_location: false,
          unassigned_communication: false,
          rotation: true,
        },
      })
      .expect(200);

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signIn(app, USERS.adminA);
    ali = await signIn(app, USERS.aliA);
    mira = await signIn(app, USERS.miraA);
    const reasons = (await admin.get('/api/v1/reasons?type=reassignment').expect(200)).body.data as { id: string; name: string }[];
    reasonId = reasons.find((r) => r.name === 'Agent unavailable')!.id;
  });

  afterAll(async () => {
    await features(false);
    await app.close();
  });

  it('City is free text on the lead: set on create, changed, cleared with an empty value', async () => {
    const lead = (await admin.post('/api/v1/leads').send({ fullName: 'City Lead', phonePrimary: '+971557770001', sourceId: SOURCE_META_A, city: '  Abu Dhabi ' }).expect(201)).body;
    expect(lead.city).toBe('Abu Dhabi');
    await admin.post('/api/v1/leads').send({ fullName: 'Too Long', phonePrimary: '+971557770002', sourceId: SOURCE_META_A, city: 'x'.repeat(101) }).expect(400);
    const changed = (await admin.patch(`/api/v1/leads/${lead.id}`).send({ version: lead.version, city: 'Dubai' }).expect(200)).body;
    expect(changed.city).toBe('Dubai');
    const cleared = (await admin.patch(`/api/v1/leads/${lead.id}`).send({ version: changed.version, city: '' }).expect(200)).body;
    expect(cleared.city).toBeUndefined();
  });

  it('reassignments keep from, to, by and when; the list shows the latest, the lead page every move', async () => {
    const lead = (await admin.post('/api/v1/leads').send({ fullName: 'Moving Lead', phonePrimary: '+971557770010', sourceId: SOURCE_META_A, city: 'Dubai', ownerUserId: USERS.aliA.id }).expect(201)).body;
    await admin.post(`/api/v1/leads/${lead.id}/assign`).send({ toUserId: USERS.miraA.id, reasonId, note: 'Ali on leave' }).expect(200);

    const history = (await mira.get(`/api/v1/leads/${lead.id}/assignments`).expect(200)).body.data;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ fromUserId: USERS.aliA.id, toUserId: USERS.miraA.id, byUserId: USERS.adminA.id, method: 'manual', reasonId, note: 'Ali on leave', at: expect.any(String) });
    expect(history[1]).toMatchObject({ fromUserId: null, toUserId: USERS.aliA.id, byUserId: USERS.adminA.id });
    // Ali no longer sees the lead, so not its history either.
    await ali.get(`/api/v1/leads/${lead.id}/assignments`).expect(404);

    const row = (await admin.get('/api/v1/leads?q=Moving%20Lead').expect(200)).body.data[0];
    expect(row.lastAssignment).toMatchObject({ fromUserId: USERS.aliA.id, toUserId: USERS.miraA.id, byUserId: USERS.adminA.id, at: history[0].at });

    // Manage Columns accepts the new columns; the Excel export has City, Assigned From, Reassigned By and Reassigned At.
    await admin.put('/api/v1/me/list-columns/leads').send({ columns: ['name', 'city', 'agent', 'assignedFrom', 'reassignedBy', 'reassignedAt'] }).expect(200);
    await admin.delete('/api/v1/me/list-columns/leads').expect(204);
    await features(true);
    const queued = await admin
      .post('/api/v1/lead-exports')
      .send({ scope: 'selected', leadIds: [lead.id], columns: ['name', 'city', 'agent', 'assignedFrom', 'reassignedBy', 'reassignedAt'] })
      .expect(202);
    await app.get(QueueService).drain('report-export');
    const link = await admin.post(`/api/v1/lead-exports/${queued.body.id}/download`).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await testStorage.read(link.body.url.replace('memory://download/', ''))) as never);
    const sheet = wb.getWorksheet('Leads')!;
    expect((sheet.getRow(1).values as string[]).slice(1)).toEqual(['Name', 'City', 'Assigned To', 'Assigned From', 'Reassigned By', 'Reassigned At']);
    expect((sheet.getRow(2).values as string[]).slice(1)).toEqual(['Moving Lead', 'Dubai', expect.stringMatching(/^Mira/), expect.stringMatching(/^Ali/), expect.stringMatching(/^Admin A/), expect.stringMatching(/\d{4}, \d{2}:\d{2}$/)]);
  });
});
