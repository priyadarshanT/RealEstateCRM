import { INestApplication } from '@nestjs/common';
import { createTestApp, signIn, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

const SOURCE_META_A = 'a1000000-0000-0000-0000-000000000001';

// Lead page appointments (stakeholder update 2026-10-17, §3 and §8): call, Zoom / online meeting, event and
// viewing for Hot and Warm leads only; past dates follow the setting; the next appointment drives the date filter.
describe('lead appointments', () => {
  let app: INestApplication;
  let admin: Client;
  let ali: Client;
  let stage: Record<string, string>;
  let sub: Record<string, string>;
  let phone = 5_779_000;
  const day = (days: number, hour: number) => {
    const d = new Date(Date.now() + days * 86_400_000);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  const newLead = async () =>
    (await admin.post('/api/v1/leads').send({ fullName: 'Appointment Lead', phonePrimary: `+97155${(phone++).toString().padStart(7, '0')}`, sourceId: SOURCE_META_A, ownerUserId: USERS.aliA.id }).expect(201)).body;
  const book = (leadId: string, extra: Record<string, unknown>) =>
    ali.post('/api/v1/meetings').send({ leadId, organizerUserId: USERS.aliA.id, type: 'call', channel: 'phone', startsAt: day(3, 6), endsAt: day(3, 7), sendConfirmation: false, ...extra });

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signIn(app, USERS.adminA);
    ali = await signIn(app, USERS.aliA);
    stage = Object.fromEntries((await admin.get('/api/v1/lead-stages').expect(200)).body.data.map((s: { key: string; id: string }) => [s.key, s.id]));
    sub = Object.fromEntries((await admin.get('/api/v1/lead-substatuses').expect(200)).body.data.map((s: { name: string; id: string }) => [s.name, s.id]));
  });

  afterAll(async () => {
    await app.close();
  });

  it('a call, a Zoom meeting with its link, an event and a viewing for a Warm lead; notes and the timeline', async () => {
    const lead = await newLead();
    const call = await book(lead.id, { notes: 'Ask about payment plan' }).expect(201);
    expect(call.body).toMatchObject({ type: 'call', channel: 'phone', notes: 'Ask about payment plan', status: 'scheduled' });

    await book(lead.id, { type: 'meeting', channel: 'online_link', startsAt: day(3, 8), endsAt: day(3, 9) }).expect(400);
    const zoom = await book(lead.id, { type: 'meeting', channel: 'online_link', joinUrl: 'https://zoom.us/j/123456789', startsAt: day(3, 8), endsAt: day(3, 9) }).expect(201);
    expect(zoom.body.joinUrl).toBe('https://zoom.us/j/123456789');
    await book(lead.id, { type: 'event', channel: 'in_person', location: 'Expo City roadshow', startsAt: day(4, 6), endsAt: day(4, 8) }).expect(201);
    await book(lead.id, { type: 'viewing', channel: 'in_person', location: 'Seapoint tower 2', startsAt: day(5, 6), endsAt: day(5, 7) }).expect(201);

    const timeline = await ali.get(`/api/v1/leads/${lead.id}/timeline?limit=20`).expect(200);
    expect(timeline.body.data.map((a: { summary: string }) => a.summary)).toEqual(expect.arrayContaining([expect.stringMatching(/^Call scheduled/), expect.stringMatching(/^Event scheduled/), expect.stringMatching(/^Viewing scheduled/)]));
  });

  it('past start times follow Enable Past Date Selection', async () => {
    const lead = await newLead();
    const past = await book(lead.id, { startsAt: day(-1, 6), endsAt: day(-1, 7) }).expect(400);
    expect(past.body.errors[0].field).toBe('startsAt');
  });

  it('the next appointment drives the Appointment Date filter; reschedule and cancel keep it in step', async () => {
    const lead = await newLead();
    const m = await book(lead.id, { startsAt: day(6, 6), endsAt: day(6, 7) }).expect(201);
    expect((await ali.get(`/api/v1/leads/${lead.id}`).expect(200)).body.nextAppointmentAt).toBe(day(6, 6));
    const date = day(6, 6).slice(0, 10);
    const inRange = await admin.get(`/api/v1/leads?dateField=appointment&dateFrom=${date}&dateTo=${date}&limit=200`).expect(200);
    expect(inRange.body.data.map((l: { id: string }) => l.id)).toContain(lead.id);

    await ali.patch(`/api/v1/meetings/${m.body.id}`).send({ startsAt: day(7, 6), endsAt: day(7, 7), notes: 'Client asked for Thursday' }).expect(200);
    expect((await ali.get(`/api/v1/leads/${lead.id}`).expect(200)).body.nextAppointmentAt).toBe(day(7, 6));
    const timeline = await ali.get(`/api/v1/leads/${lead.id}/timeline?limit=5`).expect(200);
    expect(timeline.body.data[0].summary).toMatch(/^Call rescheduled/);

    await ali.post(`/api/v1/meetings/${m.body.id}/cancel`).send({ reason: 'Client travelling' }).expect(200);
    expect((await ali.get(`/api/v1/leads/${lead.id}`).expect(200)).body.nextAppointmentAt).toBeNull();
  });

  it('Cold and Sale Done leads get no new appointments, from meetings or from tasks', async () => {
    const lead = await newLead();
    await ali.post(`/api/v1/leads/${lead.id}/stage`).send({ stageId: stage.cold, substatusId: sub['Not Interested'] }).expect(200);
    const blocked = await book(lead.id, {}).expect(422);
    expect(blocked.body.code).toBe('SCHEDULING_NOT_ALLOWED');
    const task = await ali.post('/api/v1/tasks').send({ leadId: lead.id, type: 'viewing', title: 'Viewing', dueAt: day(3, 6) }).expect(422);
    expect(task.body.code).toBe('SCHEDULING_NOT_ALLOWED');
    // A plain follow-up task is still allowed (e.g. to call back later).
    await ali.post('/api/v1/tasks').send({ leadId: lead.id, type: 'follow_up', title: 'Check in next quarter', dueAt: day(30, 6) }).expect(201);
  });
});
