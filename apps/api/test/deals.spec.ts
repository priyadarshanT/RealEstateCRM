import { INestApplication } from '@nestjs/common';
import { createTestApp, signIn, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

const AHMED = 'a2000000-0000-0000-0000-000000000001'; // tenant A lead owned by Ali

// Deals (SRS §6.5) in tenant A: offer → EOI → booking → sold moves the unit, one deal per unit, cancelling frees
// the unit, the lead timeline records each step, and access follows the lead.
describe('deals', () => {
  let app: INestApplication;
  let admin: Client;
  let ali: Client;
  let mira: Client;
  let projectId: string;
  let unitA: string;
  let unitB: string;
  let dealId: string;
  let otherLead: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signIn(app, USERS.adminA);
    ali = await signIn(app, USERS.aliA);
    mira = await signIn(app, USERS.miraA);
    const developerId = (await admin.post('/api/v1/developers').send({ name: 'Deals Spec Developer' }).expect(201)).body.id;
    projectId = (await admin.post('/api/v1/projects').send({ developerId, name: 'Deals Spec Tower' }).expect(201)).body.id;
    const unit = async (n: string) => (await admin.post('/api/v1/units').send({ projectId, unitNumber: n, propertyType: 'apartment', bedrooms: 2, sizeSqft: 1200, price: '2000000' }).expect(201)).body.id;
    unitA = await unit('101');
    unitB = await unit('102');
    const sourceId = (await admin.get('/api/v1/lead-sources?limit=100').expect(200)).body.data[0].id;
    otherLead = (await admin.post('/api/v1/leads').send({ fullName: 'Deals Spec Buyer', phonePrimary: '+971507771001', sourceId, ownerUserId: USERS.aliA.id }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('opens a deal on a lead the user can edit; others cannot see it', async () => {
    await ali.post('/api/v1/deals').send({ leadId: AHMED }).expect(400);
    const created = await ali.post('/api/v1/deals').send({ leadId: AHMED, projectId, unitId: unitA, offerPrice: '1950000' }).expect(201);
    expect(created.body).toMatchObject({ leadId: AHMED, projectId, unitId: unitA, stage: 'offer', ownerUserId: USERS.aliA.id, currency: 'AED', offerPrice: '1950000.00', offerDate: expect.any(String) });
    dealId = created.body.id;
    await mira.get(`/api/v1/deals/${dealId}`).expect(404);
    await mira.post('/api/v1/deals').send({ leadId: AHMED, projectId }).expect(404);
    expect((await mira.get(`/api/v1/deals?leadId=${AHMED}`).expect(200)).body.data).toEqual([]);
    expect((await admin.get(`/api/v1/deals?projectId=${projectId}`).expect(200)).body.data.map((d: { id: string }) => d.id)).toEqual([dealId]);
    // The unit is still available at offer stage.
    expect((await ali.get(`/api/v1/units/${unitA}`).expect(200)).body.status).toBe('available');
  });

  it('EOI holds the unit; another deal on the same unit is refused with UNIT_ALREADY_BOOKED', async () => {
    const eoi = await ali.post(`/api/v1/deals/${dealId}/stage`).send({ stage: 'eoi', amount: '50000', date: '2026-10-14' }).expect(200);
    expect(eoi.body).toMatchObject({ stage: 'eoi', eoiAmount: '50000.00', eoiDate: '2026-10-14' });
    expect((await ali.get(`/api/v1/units/${unitA}`).expect(200)).body.status).toBe('on_hold');

    const other = (await ali.post('/api/v1/deals').send({ leadId: otherLead, projectId, unitId: unitA }).expect(201)).body.id;
    const clash = await ali.post(`/api/v1/deals/${other}/stage`).send({ stage: 'eoi' }).expect(409);
    expect(clash.body.code).toBe('UNIT_ALREADY_BOOKED');
    // Stages only move forward; the unit cannot change after EOI.
    await ali.post(`/api/v1/deals/${dealId}/stage`).send({ stage: 'eoi' }).expect(400);
    await ali.patch(`/api/v1/deals/${dealId}`).send({ unitId: unitB }).expect(400);
    await ali.post(`/api/v1/deals/${other}/stage`).send({ stage: 'cancelled' }).expect(400);
    const cancelled = await ali.post(`/api/v1/deals/${other}/stage`).send({ stage: 'cancelled', cancelledReason: 'Bought elsewhere' }).expect(200);
    expect(cancelled.body).toMatchObject({ stage: 'cancelled', cancelledReason: 'Bought elsewhere' });
    // The cancelled offer never held the unit, so the unit stays with the first deal.
    expect((await ali.get(`/api/v1/units/${unitA}`).expect(200)).body.status).toBe('on_hold');
  });

  it('booking and sale mark the unit Booked then Sold, with history and timeline entries', async () => {
    await ali.post(`/api/v1/deals/${dealId}/stage`).send({ stage: 'sold' }).expect(400); // sale value needed
    const booked = await ali.post(`/api/v1/deals/${dealId}/stage`).send({ stage: 'booking', amount: '195000', date: '2026-10-20' }).expect(200);
    expect(booked.body).toMatchObject({ stage: 'booking', bookingAmount: '195000.00', bookingDate: '2026-10-20' });
    expect((await ali.get(`/api/v1/units/${unitA}`).expect(200)).body.status).toBe('booked');
    const sold = await ali.post(`/api/v1/deals/${dealId}/stage`).send({ stage: 'sold', amount: '1950000', date: '2026-11-01' }).expect(200);
    expect(sold.body).toMatchObject({ stage: 'sold', saleValue: '1950000.00', saleDate: '2026-11-01' });
    expect((await ali.get(`/api/v1/units/${unitA}`).expect(200)).body.status).toBe('sold');
    await ali.post(`/api/v1/deals/${dealId}/stage`).send({ stage: 'cancelled', cancelledReason: 'x' }).expect(409);

    const history = (await ali.get(`/api/v1/units/${unitA}/history`).expect(200)).body.data.map((c: { newStatus: string }) => c.newStatus);
    expect(history).toEqual(['sold', 'booked', 'on_hold']);
    const timeline = (await ali.get(`/api/v1/leads/${AHMED}/timeline?limit=50`).expect(200)).body.data.map((a: { summary: string }) => a.summary);
    expect(timeline).toEqual(expect.arrayContaining(['Deal opened for unit 101: offer AED 1,950,000', 'EOI for unit 101 AED 50,000', 'Booking for unit 101 AED 195,000', 'Sold: unit 101 AED 1,950,000']));
  });

  it('cancelling a booked deal frees the unit; a sold unit cannot be booked again', async () => {
    const d = (await ali.post('/api/v1/deals').send({ leadId: otherLead, projectId }).expect(201)).body.id;
    await ali.post(`/api/v1/deals/${d}/stage`).send({ stage: 'booking' }).expect(400); // no unit yet
    const sold = await ali.post(`/api/v1/deals/${d}/stage`).send({ stage: 'booking', unitId: unitA }).expect(409);
    expect(sold.body.code).toBe('UNIT_ALREADY_BOOKED');
    await ali.post(`/api/v1/deals/${d}/stage`).send({ stage: 'booking', unitId: unitB, amount: '100000' }).expect(200);
    expect((await ali.get(`/api/v1/units/${unitB}`).expect(200)).body.status).toBe('booked');
    await ali.post(`/api/v1/deals/${d}/stage`).send({ stage: 'cancelled', cancelledReason: 'Finance not approved' }).expect(200);
    expect((await ali.get(`/api/v1/units/${unitB}`).expect(200)).body.status).toBe('available');
  });

  it('files attach to a deal for users who can edit its lead', async () => {
    await mira.get(`/api/v1/deals/${dealId}/attachments`).expect(404);
    expect((await ali.get(`/api/v1/deals/${dealId}/attachments`).expect(200)).body.data).toEqual([]);
  });
});
