import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { QueueService } from '../src/core/queue/queue.service';
import { freeSlots } from '../src/modules/calendar/slots';
import { createTestApp, ownerQuery, signIn, TENANT_B, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

describe('free slots', () => {
  const base = { durationMinutes: 30, bufferMinutes: 0, minNoticeHours: 0, timeZone: 'Asia/Dubai', busy: [] };

  it('uses the weekly hours in the company time zone (Dubai is UTC+4)', () => {
    // Monday 13 Oct 2026, 09:00–10:00 Dubai = 05:00–06:00 UTC.
    const slots = freeSlots({ ...base, from: new Date('2026-10-12T20:00:00Z'), to: new Date('2026-10-13T20:00:00Z'), weeklyHours: { tue: [['09:00', '10:00']] }, now: new Date('2026-10-01T00:00:00Z') });
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual(['2026-10-13T05:00:00.000Z', '2026-10-13T05:30:00.000Z']);
  });

  it('leaves out busy times with the buffer around them, and anything sooner than the notice', () => {
    const slots = freeSlots({
      ...base,
      bufferMinutes: 15,
      minNoticeHours: 1,
      from: new Date('2026-10-13T00:00:00Z'),
      to: new Date('2026-10-14T00:00:00Z'),
      weeklyHours: { tue: [['09:00', '12:00']] },
      busy: [{ startsAt: new Date('2026-10-13T06:30:00Z'), endsAt: new Date('2026-10-13T07:00:00Z') }],
      now: new Date('2026-10-13T04:30:00Z'),
    });
    // Slots every 45 min from 05:00Z: 05:00 is inside the 1-hour notice; 06:30 overlaps the busy time ± 15 min
    // (06:15–07:15); 05:45–06:15 and 07:15–07:45 only touch it.
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual(['2026-10-13T05:45:00.000Z', '2026-10-13T07:15:00.000Z']);
  });
});

// Meetings and the booking page (SRS §3.8–3.12, §15.8) in tenant B with CALENDAR_MODE=simulate.
describe('meetings and booking page', () => {
  let app: INestApplication;
  let queue: QueueService;
  let admin: Client;
  let agent: Client;
  let other: Client;
  let leadId: string;
  let meetingId: string;
  const AGENT = { id: 'b0000000-0000-0000-0000-0000000000d1', email: 'cal.agent@b.ae', tenant: TENANT_B };
  const OTHER = { id: 'b0000000-0000-0000-0000-0000000000d2', email: 'cal.other@b.ae', tenant: TENANT_B };
  const ALL_DAY = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [['08:00', '20:00']]]));
  const at = (daysAhead: number, hourUtc: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + daysAhead);
    d.setUTCHours(hourUtc, 0, 0, 0);
    return d;
  };

  beforeAll(async () => {
    app = await createTestApp();
    queue = app.get(QueueService);
    for (const u of [AGENT, OTHER]) {
      await ownerQuery(
        `INSERT INTO users (id, tenant_id, email, full_name, role_id, status)
         SELECT $1, $2, $3, $4, id, 'active' FROM roles WHERE tenant_id = $2 AND key = 'sales_agent' ON CONFLICT (id) DO NOTHING`,
        [u.id, u.tenant, u.email, u.email === AGENT.email ? 'Hana Agent' : 'Other Agent'],
      );
    }
    admin = await signIn(app, USERS.adminB);
    agent = await signIn(app, AGENT);
    other = await signIn(app, OTHER);
    await admin.post('/api/v1/integrations').send({ provider: 'email_ses', settings: { fromAddress: 'bookings@other.ae' } }).expect(201);
    const sourceId = (await admin.post('/api/v1/lead-sources').send({ type: 'website', name: 'Calendar source' }).expect(201)).body.id;
    leadId = (await admin.post('/api/v1/leads').send({ fullName: 'Karim Saleh', phonePrimary: '+971559990001', email: 'karim@example.ae', sourceId, ownerUserId: AGENT.id }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a Google Meet meeting with its link, calendar task, timeline entry and client confirmation', async () => {
    const res = await agent
      .post('/api/v1/meetings')
      .send({ leadId, organizerUserId: AGENT.id, type: 'meeting', channel: 'google_meet', startsAt: at(3, 6).toISOString(), endsAt: at(3, 7).toISOString(), clientTimezone: 'Europe/London' })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'scheduled', bookedVia: 'agent', joinUrl: expect.stringMatching(/^https:\/\/meet\.google\.com\/sim-/), clientTimezone: 'Europe/London' });
    meetingId = res.body.id;

    const [task] = await ownerQuery<{ type: string; due_at: Date; duration_minutes: number; status: string }>('SELECT type, due_at, duration_minutes, status FROM tasks WHERE meeting_id = $1', [meetingId]);
    expect(task).toMatchObject({ type: 'meeting', due_at: at(3, 6), duration_minutes: 60, status: 'open' });
    const timeline = (await agent.get(`/api/v1/leads/${leadId}/timeline`).expect(200)).body.data;
    expect(timeline.map((a: { summary: string }) => a.summary)).toEqual(expect.arrayContaining([expect.stringMatching(/^Meeting scheduled: .* · Google Meet$/), 'Email: your meeting is confirmed']));
    await queue.drain('send-message');
    const [email] = await ownerQuery<{ subject: string; body: string; status: string }>("SELECT subject, body, status FROM messages WHERE lead_id = $1 AND subject LIKE 'Your meeting%'", [leadId]);
    expect(email).toMatchObject({ subject: 'Your meeting is confirmed', status: 'sent', body: expect.stringContaining('(Europe/London)') });
  });

  it('an agent cannot be double-booked (409 AGENT_BUSY); another agent at the same time is fine', async () => {
    const clash = await agent
      .post('/api/v1/meetings')
      .send({ leadId, organizerUserId: AGENT.id, type: 'viewing', channel: 'in_person', location: 'Dubai Marina', startsAt: at(3, 6.5).toISOString(), endsAt: at(3, 8).toISOString(), sendConfirmation: false })
      .expect(409);
    expect(clash.body.code).toBe('AGENT_BUSY');
    await agent
      .post('/api/v1/meetings')
      .send({ leadId, organizerUserId: OTHER.id, type: 'viewing', channel: 'in_person', location: 'Dubai Marina', startsAt: at(3, 6).toISOString(), endsAt: at(3, 7).toISOString(), sendConfirmation: false })
      .expect(201);
  });

  it('rescheduling moves the task and counts the change; overlapping is refused', async () => {
    const moved = await agent.patch(`/api/v1/meetings/${meetingId}`).send({ startsAt: at(4, 6).toISOString() }).expect(200);
    expect(moved.body).toMatchObject({ startsAt: at(4, 6).toISOString(), endsAt: at(4, 7).toISOString() });
    const [row] = await ownerQuery<{ reschedule_count: number }>('SELECT reschedule_count FROM meetings WHERE id = $1', [meetingId]);
    expect(row!.reschedule_count).toBe(1);
    const [task] = await ownerQuery<{ due_at: Date }>('SELECT due_at FROM tasks WHERE meeting_id = $1', [meetingId]);
    expect(task!.due_at).toEqual(at(4, 6));

    const blocker = await agent
      .post('/api/v1/meetings')
      .send({ leadId, organizerUserId: AGENT.id, type: 'meeting', channel: 'phone', startsAt: at(5, 6).toISOString(), endsAt: at(5, 7).toISOString(), sendConfirmation: false })
      .expect(201);
    expect((await agent.patch(`/api/v1/meetings/${meetingId}`).send({ startsAt: at(5, 6).toISOString() }).expect(409)).body.code).toBe('AGENT_BUSY');
    await agent.post(`/api/v1/meetings/${blocker.body.id}/cancel`).send({}).expect(400);
    const cancelled = await agent.post(`/api/v1/meetings/${blocker.body.id}/cancel`).send({ reason: 'Client asked' }).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelReason: 'Client asked' });
    const [cancelledTask] = await ownerQuery<{ status: string }>('SELECT status FROM tasks WHERE meeting_id = $1', [blocker.body.id]);
    expect(cancelledTask!.status).toBe('cancelled');
  });

  it('completing records no-show and plans the next action', async () => {
    const done = await agent
      .post(`/api/v1/meetings/${meetingId}/complete`)
      .send({ status: 'no_show', note: 'Did not join', nextAction: { type: 'call', dueAt: at(6, 6).toISOString() } })
      .expect(200);
    expect(done.body.status).toBe('no_show');
    const tasks = await ownerQuery<{ type: string; status: string; meeting_id: string | null }>('SELECT type, status, meeting_id FROM tasks WHERE lead_id = $1 ORDER BY created_at', [leadId]);
    expect(tasks).toEqual(expect.arrayContaining([{ type: 'meeting', status: 'completed', meeting_id: meetingId }, { type: 'call', status: 'open', meeting_id: null }]));
  });

  it('meetings follow the lead data scope', async () => {
    await other.get(`/api/v1/meetings/${meetingId}`).expect(404);
    expect((await agent.get(`/api/v1/meetings?leadId=${leadId}`).expect(200)).body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('each agent saves one booking page; link names are unique', async () => {
    await agent.get('/api/v1/booking-pages/me').expect(404);
    const badHours = await agent.put('/api/v1/booking-pages/me').send({ slug: 'hana-agent', title: 'Book a call with Hana', durationMinutes: 30, weeklyHours: { mon: [['10:00', '09:00']] }, isActive: true }).expect(400);
    expect(badHours.body.errors[0].field).toBe('weeklyHours.mon');
    const saved = await agent
      .put('/api/v1/booking-pages/me')
      .send({ slug: 'hana-agent', title: 'Book a call with Hana', meetingChannel: 'google_meet', durationMinutes: 30, bufferMinutes: 0, minNoticeHours: 0, weeklyHours: ALL_DAY, isActive: true })
      .expect(200);
    expect(saved.body).toMatchObject({ slug: 'hana-agent', publicUrl: expect.stringMatching(/\/book\/hana-agent$/) });
    const taken = await other.put('/api/v1/booking-pages/me').send({ slug: 'hana-agent', title: 'x', durationMinutes: 30, weeklyHours: {}, isActive: true }).expect(409);
    expect(taken.body.code).toBe('SLUG_TAKEN');
    expect((await agent.get('/api/v1/booking-pages/me').expect(200)).body.title).toBe('Book a call with Hana');
  });

  it('agents see free slots without booked times', async () => {
    await agent
      .post('/api/v1/meetings')
      .send({ leadId, organizerUserId: AGENT.id, type: 'meeting', channel: 'phone', startsAt: at(8, 6).toISOString(), endsAt: at(8, 7).toISOString(), sendConfirmation: false })
      .expect(201);
    const free = (await agent.get(`/api/v1/availability?userId=${AGENT.id}&from=${at(8, 4).toISOString()}&to=${at(8, 9).toISOString()}&durationMinutes=60`).expect(200)).body.slots;
    // Booking-page hours 08:00–20:00 Dubai = 04:00–16:00 UTC, no buffer: 06:00 is booked, the hours around it are free.
    expect(free.map((s: { startsAt: string }) => s.startsAt)).toEqual([at(8, 4), at(8, 5), at(8, 7), at(8, 8)].map((d) => d.toISOString()));
  });

  it('a client books without login: new lead owned by the agent, meeting with link, consent, notification; the slot is then taken', async () => {
    const server = app.getHttpServer();
    const page = await request(server).get(`/api/v1/public/booking/hana-agent?timezone=Europe/London`).expect(200);
    expect(page.body).toMatchObject({ title: 'Book a call with Hana', agentName: 'Hana Agent', companyName: 'Other Brokerage', durationMinutes: 30 });
    const slot = page.body.slots.find((s: { startsAt: string }) => new Date(s.startsAt) > at(7, 0));
    expect(slot).toBeDefined();
    const client = { startsAt: slot.startsAt, fullName: 'James Carter', phone: '+447700900123', email: 'james@example.co.uk', timezone: 'Europe/London', consentWhatsApp: true };

    await request(server).post('/api/v1/public/booking/hana-agent').send(client).expect(422); // no bot-check token
    const booked = await request(server).post('/api/v1/public/booking/hana-agent').set('CF-Turnstile-Token', 'ok').send(client).expect(201);
    expect(booked.body).toMatchObject({ startsAt: slot.startsAt, timezone: 'Europe/London', joinUrl: expect.stringMatching(/^https:\/\/meet\.google\.com\//) });

    const [lead] = await ownerQuery<{ id: string; owner_user_id: string; source: string }>(
      "SELECT l.id, l.owner_user_id, s.name AS source FROM leads l JOIN lead_sources s ON s.id = l.source_id WHERE l.tenant_id = $1 AND l.phone_primary = '+447700900123'",
      [TENANT_B],
    );
    expect(lead).toMatchObject({ owner_user_id: AGENT.id, source: 'Booking page' });
    const [meeting] = await ownerQuery<{ booked_via: string; created_by: string | null }>('SELECT booked_via, created_by FROM meetings WHERE lead_id = $1', [lead!.id]);
    expect(meeting).toEqual({ booked_via: 'booking_page', created_by: null });
    const [consent] = await ownerQuery<{ status: string; capture_method: string }>("SELECT status, capture_method FROM consents WHERE lead_id = $1 AND channel = 'whatsapp'", [lead!.id]);
    expect(consent).toEqual({ status: 'opted_in', capture_method: 'form' });
    expect((await agent.get('/api/v1/notifications').expect(200)).body.data.map((n: { title: string }) => n.title)).toContain('New booking: James Carter');

    const again = await request(server).post('/api/v1/public/booking/hana-agent').set('CF-Turnstile-Token', 'ok').send({ ...client, phone: '+447700900124', email: undefined }).expect(409);
    expect(again.body.code).toBe('SLOT_TAKEN');
  });

  it('a returning client is added to the existing lead (re-enquiry), not duplicated', async () => {
    const server = app.getHttpServer();
    const slots = (await request(server).get('/api/v1/public/booking/hana-agent').expect(200)).body.slots;
    const later = slots.find((s: { startsAt: string }) => new Date(s.startsAt) > at(9, 0));
    await request(server).post('/api/v1/public/booking/hana-agent').set('CF-Turnstile-Token', 'ok').send({ startsAt: later.startsAt, fullName: 'Karim S.', phone: '+971559990001', timezone: 'Asia/Dubai' }).expect(201);
    const [count] = await ownerQuery<{ n: number }>("SELECT count(*)::int AS n FROM leads WHERE tenant_id = $1 AND phone_primary = '+971559990001'", [TENANT_B]);
    expect(count!.n).toBe(1);
    const [lead] = await ownerQuery<{ enquiry_count: number }>('SELECT enquiry_count FROM leads WHERE id = $1', [leadId]);
    expect(lead!.enquiry_count).toBe(2);
  });

  it('a switched-off page is not found', async () => {
    await agent.put('/api/v1/booking-pages/me').send({ slug: 'hana-agent', title: 'Off', durationMinutes: 30, weeklyHours: ALL_DAY, isActive: false }).expect(200);
    await request(app.getHttpServer()).get('/api/v1/public/booking/hana-agent').expect(404);
  });
});
