import { INestApplication } from '@nestjs/common';
import { createTestApp, signIn, testStorage, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

// Projects and units (SRS §6.1–6.4) in tenant A: developers, projects with inventory, buildings, units with
// filters, price and status changes with history, roles, attachments, and tenant B isolation.
describe('projects and units', () => {
  let app: INestApplication;
  let admin: Client;
  let agent: Client;
  let adminB: Client;
  let developerId: string;
  let projectId: string;
  let buildingId: string;
  let unitIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signIn(app, USERS.adminA);
    agent = await signIn(app, USERS.aliA);
    adminB = await signIn(app, USERS.adminB);
  });

  afterAll(async () => {
    await app.close();
  });

  it('developers: only projects.manage creates them; names are unique; phone and email are checked', async () => {
    await agent.post('/api/v1/developers').send({ name: 'Emaar' }).expect(403);
    const bad = await admin.post('/api/v1/developers').send({ name: 'Emaar Spec', phone: '12345', email: 'nope' }).expect(400);
    expect(bad.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(['email', 'phone']);
    const created = await admin.post('/api/v1/developers').send({ name: 'Emaar Spec', phone: '+971 4 366 1688', email: 'Sales@Emaar.test', trn: '100000000000003' }).expect(201);
    expect(created.body).toMatchObject({ name: 'Emaar Spec', phone: '+97143661688', email: 'sales@emaar.test' });
    expect(created.headers.etag).toBeDefined();
    developerId = created.body.id;
    await admin.post('/api/v1/developers').send({ name: 'Emaar Spec' }).expect(409);
    const list = await agent.get('/api/v1/developers?limit=100').expect(200);
    expect(list.body.data.map((d: { id: string }) => d.id)).toContain(developerId);
    // Stale If-Match is refused.
    const etag = (await admin.get(`/api/v1/developers/${developerId}`).expect(200)).headers.etag!;
    await admin.patch(`/api/v1/developers/${developerId}`).set('If-Match', etag).send({ contactName: 'Layla' }).expect(200);
    await admin.patch(`/api/v1/developers/${developerId}`).set('If-Match', etag).send({ contactName: 'Old' }).expect(409);
  });

  it('projects and buildings: created by projects.manage, listed with filters and inventory', async () => {
    await admin.post('/api/v1/projects').send({ name: 'No developer' }).expect(400);
    await agent.post('/api/v1/projects').send({ developerId, name: 'X' }).expect(403);
    const p = await admin
      .post('/api/v1/projects')
      .send({ developerId, name: 'Creek Vista Spec', community: 'Dubai Creek Harbour', constructionStatus: 'off_plan', handoverDate: '2028-06-30', paymentPlan: '80/20', latitude: 25.2048, longitude: 55.3471 })
      .expect(201);
    expect(p.body).toMatchObject({ name: 'Creek Vista Spec', city: 'Dubai', latitude: 25.2048, handoverDate: '2028-06-30', isActive: true, inventory: { available: 0, onHold: 0, booked: 0, sold: 0 } });
    projectId = p.body.id;
    await admin.post('/api/v1/projects').send({ developerId, name: 'Creek Vista Spec' }).expect(409);

    const b = await admin.post(`/api/v1/projects/${projectId}/buildings`).send({ name: 'Tower A', floors: 40 }).expect(201);
    buildingId = b.body.id;
    await admin.patch(`/api/v1/buildings/${buildingId}`).send({ handoverDate: '2028-03-31' }).expect(200);
    const buildings = await agent.get(`/api/v1/projects/${projectId}/buildings`).expect(200);
    expect(buildings.body.data).toEqual([expect.objectContaining({ name: 'Tower A', floors: 40, handoverDate: '2028-03-31' })]);

    const filtered = await agent.get(`/api/v1/projects?developerId=${developerId}&q=vista&isActive=true`).expect(200);
    expect(filtered.body.data.map((x: { id: string }) => x.id)).toEqual([projectId]);
    expect((await adminB.get(`/api/v1/projects/${projectId}`)).status).toBe(404);
  });

  it('units: created with details, filtered, sorted by number; price and status cannot change through details', async () => {
    await admin.post('/api/v1/units').send({ projectId, unitNumber: '1', propertyType: 'castle', bedrooms: 1, sizeSqft: 700, price: '1.00' }).expect(400);
    const other = (await admin.post('/api/v1/projects').send({ developerId, name: 'Other Spec' }).expect(201)).body.id;
    const wrongBuilding = await admin.post('/api/v1/units').send({ projectId: other, buildingId, unitNumber: '1', propertyType: 'apartment', bedrooms: 1, sizeSqft: 700, price: '1.00' }).expect(400);
    expect(wrongBuilding.body.errors[0].field).toBe('buildingId');
    for (const [n, beds, price] of [['1004', 1, '1450000'], ['902', 2, '2100000.50'], ['1204', 3, '3250000']] as const) {
      const u = await admin.post('/api/v1/units').send({ projectId, buildingId, unitNumber: n, propertyType: 'apartment', bedrooms: beds, sizeSqft: 650 + beds * 300, floor: Number(n.slice(0, -2)), view: 'Creek', price }).expect(201);
      expect(u.body).toMatchObject({ status: 'available', currency: 'AED' });
      unitIds.push(u.body.id);
    }
    await admin.post('/api/v1/units').send({ projectId, buildingId, unitNumber: '902', propertyType: 'apartment', bedrooms: 1, sizeSqft: 700, price: '1.00' }).expect(409);

    const all = await agent.get(`/api/v1/units?projectId=${projectId}`).expect(200);
    expect(all.body.data.map((u: { unitNumber: string }) => u.unitNumber)).toEqual(['902', '1004', '1204']);
    expect(all.body.data[0]).toMatchObject({ price: '2100000.50', sizeSqft: 1250 });
    const twoBeds = await agent.get(`/api/v1/units?projectId=${projectId}&bedrooms=2`).expect(200);
    expect(twoBeds.body.data).toHaveLength(1);
    const range = await agent.get(`/api/v1/units?projectId=${projectId}&priceMin=1500000.00&priceMax=3000000.00`).expect(200);
    expect(range.body.data.map((u: { unitNumber: string }) => u.unitNumber)).toEqual(['902']);
    const paged = await agent.get(`/api/v1/units?projectId=${projectId}&limit=2`).expect(200);
    const next = await agent.get(`/api/v1/units?projectId=${projectId}&limit=2&cursor=${paged.body.page.nextCursor}`).expect(200);
    expect(next.body.data.map((u: { unitNumber: string }) => u.unitNumber)).toEqual(['1204']);

    const blocked = await admin.patch(`/api/v1/units/${unitIds[0]}`).send({ price: '1.00' }).expect(400);
    expect(blocked.body.errors[0].message).toMatch(/units\/\{id\}\/status/);
    const edited = await admin.patch(`/api/v1/units/${unitIds[0]}`).send({ view: 'Burj Khalifa', bathrooms: 2 }).expect(200);
    expect(edited.body).toMatchObject({ view: 'Burj Khalifa', bathrooms: 2, price: '1450000.00' });
  });

  it('status and price changes need units.change_status and are kept in history; inventory follows', async () => {
    await agent.post(`/api/v1/units/${unitIds[0]}/status`).send({ status: 'on_hold' }).expect(403);
    await admin.post(`/api/v1/units/${unitIds[0]}/status`).send({}).expect(400);
    await admin.post(`/api/v1/units/${unitIds[0]}/status`).send({ status: 'on_hold', holdExpiresAt: '2020-01-01T00:00:00Z' }).expect(400);
    await admin.post(`/api/v1/units/${unitIds[0]}/status`).send({ status: 'available' }).expect(400); // nothing changes
    const hold = await admin.post(`/api/v1/units/${unitIds[0]}/status`).send({ status: 'on_hold', holdExpiresAt: '2030-01-01T12:00:00Z', reason: 'Client deciding' }).expect(200);
    expect(hold.body).toMatchObject({ status: 'on_hold', holdExpiresAt: '2030-01-01T12:00:00.000Z' });
    await admin.post(`/api/v1/units/${unitIds[0]}/status`).send({ price: '1500000.00', reason: 'Price list v2' }).expect(200);
    const released = await admin.post(`/api/v1/units/${unitIds[0]}/status`).send({ status: 'available', reason: 'Client passed' }).expect(200);
    expect(released.body).toMatchObject({ status: 'available', holdExpiresAt: null, price: '1500000.00' });
    await admin.post(`/api/v1/units/${unitIds[1]}/status`).send({ status: 'sold' }).expect(200);

    const history = await agent.get(`/api/v1/units/${unitIds[0]}/history`).expect(200);
    expect(history.body.data).toEqual([
      expect.objectContaining({ oldStatus: 'on_hold', newStatus: 'available', oldPrice: null, reason: 'Client passed', changedBy: USERS.adminA.id }),
      expect.objectContaining({ oldStatus: null, newStatus: null, oldPrice: '1450000.00', newPrice: '1500000.00', reason: 'Price list v2' }),
      expect.objectContaining({ oldStatus: 'available', newStatus: 'on_hold', reason: 'Client deciding' }),
    ]);
    const project = await agent.get(`/api/v1/projects/${projectId}`).expect(200);
    expect(project.body.inventory).toEqual({ available: 2, onHold: 0, booked: 0, sold: 1 });
    const sold = await agent.get(`/api/v1/units?projectId=${projectId}&status=sold`).expect(200);
    expect(sold.body.data.map((u: { id: string }) => u.id)).toEqual([unitIds[1]]);
  });

  it('attachments: brochure and floor plan files on projects and units; download links for every user', async () => {
    const upload = async (fileName: string, purpose: string) => {
      const body = Buffer.from('%PDF-1.4 spec');
      const ticket = await admin.post('/api/v1/files/uploads').send({ fileName, mimeType: 'application/pdf', sizeBytes: body.length, purpose }).expect(201);
      await testStorage.write(ticket.body.uploadUrl.replace('memory://upload/', ''), body, 'application/pdf');
      await admin.post(`/api/v1/files/${ticket.body.fileId}/complete`).expect(200);
      return ticket.body.fileId as string;
    };
    const brochure = await upload('creek-vista.pdf', 'project_media');
    const a = await admin.post(`/api/v1/projects/${projectId}/attachments`).send({ fileId: brochure, category: 'brochure', sortOrder: 1 }).expect(201);
    expect(a.body).toMatchObject({ fileId: brochure, fileName: 'creek-vista.pdf', category: 'brochure' });
    await admin.patch(`/api/v1/projects/${projectId}`).send({ brochureFileId: brochure }).expect(200);
    await agent.post(`/api/v1/projects/${projectId}/attachments`).send({ fileId: brochure, category: 'brochure' }).expect(403);

    const plan = await upload('1204-plan.pdf', 'unit_floor_plan');
    await admin.post(`/api/v1/units/${unitIds[2]}/attachments`).send({ fileId: plan, category: 'floor_plan' }).expect(201);
    await admin.patch(`/api/v1/units/${unitIds[2]}`).send({ floorPlanFileId: plan }).expect(200);
    const files = await admin.get(`/api/v1/units/${unitIds[2]}/attachments`).expect(200);
    expect(files.body.data).toEqual([expect.objectContaining({ fileId: plan, category: 'floor_plan' })]);
    // Any user who can see the project can download its brochure.
    await agent.get(`/api/v1/files/${brochure}/download`).expect(200);
    await adminB.get(`/api/v1/files/${brochure}/download`).expect(404);
  });

  it('a project in use cannot be deleted; an unused one can', async () => {
    await admin.delete(`/api/v1/projects/${projectId}`).expect(409);
    await admin.delete(`/api/v1/developers/${developerId}`).expect(409);
    const empty = (await admin.post('/api/v1/projects').send({ developerId, name: 'Empty Spec' }).expect(201)).body.id;
    await admin.post(`/api/v1/projects/${empty}/buildings`).send({ name: 'Phase 1' }).expect(201);
    await admin.delete(`/api/v1/projects/${empty}`).expect(204);
  });
});
