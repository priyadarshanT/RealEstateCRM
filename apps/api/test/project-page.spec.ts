import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { QueueService } from '../src/core/queue/queue.service';
import { createTestApp, signIn, testStorage, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

const PROJECT_BEACHFRONT = 'a4000000-0000-0000-0000-000000000001';

// Project page (stakeholder update 2026-10-17): category tabs with counts, Assigned To, starting price, custom fields
// (Admin), date range, Lead Count in the user's lead access, Export Projects and its tracker count.
describe('project page', () => {
  let app: INestApplication;
  let admin: Client;
  let ali: Client;
  let developerId: string;
  let projectId: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signIn(app, USERS.adminA);
    ali = await signIn(app, USERS.aliA);
    developerId = (await admin.post('/api/v1/developers').send({ name: 'Project Page Developer' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('custom fields: Admin adds them; projects are checked against them', async () => {
    await ali.post('/api/v1/project-custom-fields').send({ label: 'Plot size', fieldType: 'number' }).expect(403);
    const size = await admin.post('/api/v1/project-custom-fields').send({ label: 'Plot size', fieldType: 'number' }).expect(201);
    expect(size.body).toMatchObject({ key: 'plot_size', fieldType: 'number', isRequired: false });
    await admin.post('/api/v1/project-custom-fields').send({ label: 'Zone', fieldType: 'dropdown' }).expect(400);
    const zone = await admin.post('/api/v1/project-custom-fields').send({ label: 'Zone', fieldType: 'dropdown', options: ['Freehold', 'Leasehold'], isRequired: true }).expect(201);
    await admin.post('/api/v1/project-custom-fields').send({ label: 'Zone', fieldType: 'text' }).expect(409);
    expect((await ali.get('/api/v1/project-custom-fields').expect(200)).body.data.map((f: { key: string }) => f.key)).toEqual(expect.arrayContaining(['plot_size', 'zone']));

    const missing = await admin.post('/api/v1/projects').send({ developerId, name: 'Logistics Park' }).expect(400);
    expect(missing.body.errors[0].field).toBe('customValues.zone');
    await admin.post('/api/v1/projects').send({ developerId, name: 'Logistics Park', customValues: { zone: 'Other' } }).expect(400);
    await admin.post('/api/v1/projects').send({ developerId, name: 'Logistics Park', customValues: { zone: 'Freehold', plot_size: 'big' } }).expect(400);
    const created = await admin
      .post('/api/v1/projects')
      .send({ developerId, name: 'Logistics Park', category: 'commercial', assignedUserId: USERS.saraA.id, handoverDate: '2027-06-30', customValues: { zone: 'Freehold', plot_size: 12000 } })
      .expect(201);
    expect(created.body).toMatchObject({ category: 'commercial', assignedUserId: USERS.saraA.id, customValues: { zone: 'Freehold', plot_size: 12000 }, startingPrice: null });
    projectId = created.body.id;
    await admin.patch(`/api/v1/projects/${projectId}`).send({ customValues: { zone: null } }).expect(400);
    await admin.patch(`/api/v1/project-custom-fields/${zone.body.id}`).send({ fieldType: 'text' }).expect(400);
    // Later tests create projects without a zone.
    await admin.patch(`/api/v1/project-custom-fields/${zone.body.id}`).send({ isRequired: false }).expect(200);

    // Custom fields can be chosen in Manage Columns.
    await ali.put('/api/v1/me/list-columns/projects').send({ columns: ['name', 'cf:plot_size'] }).expect(200);
    expect((await ali.get('/api/v1/me/list-columns/projects').expect(200)).body.columns).toEqual(['name', 'cf:plot_size']);
    await ali.put('/api/v1/me/list-columns/projects').send({ columns: ['name', 'cf:'] }).expect(400);
  });

  it('starting price is the lowest available unit price', async () => {
    await admin.post('/api/v1/units').send({ projectId, unitNumber: 'W-1', propertyType: 'office', bedrooms: 0, sizeSqft: 5000, price: '9000000' }).expect(201);
    await admin.post('/api/v1/units').send({ projectId, unitNumber: 'W-2', propertyType: 'office', bedrooms: 0, sizeSqft: 3000, price: '6500000' }).expect(201);
    expect((await admin.get(`/api/v1/projects/${projectId}`).expect(200)).body.startingPrice).toEqual({ amount: '6500000.00', currency: 'AED' });
  });

  it('category tabs with counts and filters; the date range uses the chosen date field', async () => {
    await admin.post('/api/v1/projects').send({ developerId, name: 'Date Farms', category: 'agricultural', handoverDate: '2030-01-15' }).expect(201);
    const counts = await admin.get(`/api/v1/projects/category-counts?developerId=${developerId}`).expect(200);
    expect(counts.body).toEqual({ data: [{ category: 'residential', count: 0 }, { category: 'commercial', count: 1 }, { category: 'agricultural', count: 1 }], total: 2 });
    const agri = await admin.get(`/api/v1/projects?developerId=${developerId}&category=agricultural&total=true`).expect(200);
    expect(agri.body.page.total).toBe(1);
    const handover = await admin.get(`/api/v1/projects?developerId=${developerId}&dateField=handover&dateFrom=2030-01-01&dateTo=2030-01-31`).expect(200);
    expect(handover.body.data.map((p: { name: string }) => p.name)).toEqual(['Date Farms']);
    const today = new Date().toISOString().slice(0, 10);
    const created = await admin.get(`/api/v1/projects/category-counts?developerId=${developerId}&dateField=created&dateFrom=${today}&dateTo=${today}`).expect(200);
    expect(created.body.total).toBe(2);
  });

  it('Lead Count follows each user\'s lead access', async () => {
    const all = await admin.get(`/api/v1/leads/project-counts?projectIds=${PROJECT_BEACHFRONT},${projectId}`).expect(200);
    const own = await ali.get(`/api/v1/leads/project-counts?projectIds=${PROJECT_BEACHFRONT},${projectId}`).expect(200);
    const count = (r: { body: { data: { projectId: string; count: number }[] } }, id: string) => r.body.data.find((x) => x.projectId === id)!.count;
    expect(count(all, PROJECT_BEACHFRONT)).toBeGreaterThanOrEqual(count(own, PROJECT_BEACHFRONT));
    expect(count(all, projectId)).toBe(0);
    await admin.get('/api/v1/leads/project-counts?projectIds=nope').expect(400);
  });

  it('Export Projects needs projects.export; the file has the chosen columns with custom fields; the tracker counts jobs', async () => {
    await ali.post('/api/v1/project-exports').send({ scope: 'selected', projectIds: [projectId], columns: ['name'] }).expect(403);
    await admin.post('/api/v1/project-exports').send({ scope: 'selected', projectIds: [projectId], columns: ['name', 'salary'] }).expect(400);
    const before = (await admin.get('/api/v1/project-exports').expect(200)).body.page.total;
    const queued = await admin
      .post('/api/v1/project-exports')
      .send({ scope: 'selected', projectIds: [projectId], columns: ['name', 'category', 'availability', 'assignedTo', 'startingPrice', 'leadCount', 'cf:zone', 'cf:plot_size'] })
      .expect(202);
    await app.get(QueueService).drain('report-export');
    const tracker = await admin.get('/api/v1/project-exports').expect(200);
    expect(tracker.body.page.total).toBe(before + 1);
    expect(tracker.body.data[0]).toMatchObject({ id: queued.body.id, status: 'ready', recordCount: 1, exportId: expect.stringMatching(/^PX-/) });
    const link = await admin.post(`/api/v1/project-exports/${queued.body.id}/download`).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await testStorage.read(link.body.url.replace('memory://download/', ''))) as never);
    const sheet = wb.getWorksheet('Projects')!;
    expect((sheet.getRow(1).values as string[]).slice(1)).toEqual(['Project Name', 'Project Type', 'Availability', 'Assigned To', 'Starting Price', 'Lead Count', 'Zone', 'Plot size']);
    expect((sheet.getRow(2).values as unknown[]).slice(1)).toEqual(['Logistics Park', 'Commercial', '2 of 2 available', 'Sara', 6500000, 0, 'Freehold', 12000]);
    // Lead exports are a separate tracker.
    expect((await admin.get('/api/v1/lead-exports').expect(200)).body.data.find((e: { id: string }) => e.id === queued.body.id)).toBeUndefined();
  });
});
