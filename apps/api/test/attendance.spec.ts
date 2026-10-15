import { INestApplication } from '@nestjs/common';
import { DbService } from '../src/core/database/db.service';
import { QueueService } from '../src/core/queue/queue.service';
import { LeaveService } from '../src/modules/attendance/leave.service';
import { createTestApp, ownerQuery, signIn, TENANT_A, testStorage, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

const dubaiDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86_400_000));
const dubaiMinutes = () => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':');
  return Number(h) * 60 + Number(m);
};
/** The next Monday (Dubai) at least a week ahead, so the dates are working days in the future. */
const nextMonday = () => {
  for (let i = 7; i < 14; i++) if (new Date(`${dubaiDate(i)}T12:00:00Z`).getUTCDay() === 1) return i;
  return 7;
};

// Attendance (SRS §9) in tenant A: policies, check-in / out with photo and status, location rules, records by
// scope, corrections (original kept), leave with allowance, overlap and self-review rules, leave days, close of day.
describe('attendance', () => {
  let app: INestApplication;
  let admin: Client;
  let ali: Client;
  let mira: Client;
  let sara: Client;
  let policyId: string;
  let aliRecord: string;

  const photo = async (client: Client) => {
    const body = Buffer.from('jpeg');
    const ticket = await client.post('/api/v1/files/uploads').send({ fileName: 'selfie.jpg', mimeType: 'image/jpeg', sizeBytes: body.length, purpose: 'attendance_photo' }).expect(201);
    await testStorage.write(ticket.body.uploadUrl.replace('memory://upload/', ''), body, 'image/jpeg');
    await client.post(`/api/v1/files/${ticket.body.fileId}/complete`).expect(200);
    return ticket.body.fileId as string;
  };

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signIn(app, USERS.adminA);
    ali = await signIn(app, USERS.aliA);
    mira = await signIn(app, USERS.miraA);
    sara = await signIn(app, USERS.saraA);
    await ownerQuery(`DELETE FROM attendance_records WHERE tenant_id = $1`, [TENANT_A]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('policies: only settings.manage changes them; the first one is the default; times are checked', async () => {
    await ali.post('/api/v1/attendance-policies').send({ name: 'X', workStart: '09:00', workEnd: '18:00' }).expect(403);
    await admin.post('/api/v1/attendance-policies').send({ name: 'Bad', workStart: '18:00', workEnd: '09:00' }).expect(400);
    await admin.post('/api/v1/attendance-policies').send({ name: 'Bad', workStart: '09:00', workEnd: '18:00', officeRadiusM: 100 }).expect(400);
    // Office starts at midnight with no grace, so anyone checking in now is late (unless it is exactly 00:00).
    const created = await admin.post('/api/v1/attendance-policies').send({ name: 'Spec office', workStart: '00:00', workEnd: '23:59', graceMinutes: 0, halfDayMaxMinutes: 300, weekendDays: [0, 6] }).expect(201);
    expect(created.body).toMatchObject({ isDefault: true, workStart: '00:00', weekendDays: [0, 6], locationRequired: false });
    policyId = created.body.id;
    const list = await ali.get('/api/v1/attendance-policies').expect(200);
    expect(list.body.data.map((x: { id: string }) => x.id)).toContain(policyId);
    await admin.delete(`/api/v1/attendance-policies/${policyId}`).expect(409); // the default
  });

  it('check-in with a photo sets Late by policy; a second check-in is refused; check-out early makes a Half Day', async () => {
    await ali.post('/api/v1/attendance/check-out').send({ photoFileId: await photo(ali) }).expect(409);
    await ali.post('/api/v1/attendance/check-in').send({ photoFileId: '00000000-0000-4000-8000-000000000000' }).expect(400);
    const inRec = await ali.post('/api/v1/attendance/check-in').send({ photoFileId: await photo(ali), latitude: 25.2, longitude: 55.3 }).expect(201);
    expect(inRec.body).toMatchObject({ userId: USERS.aliA.id, workDate: dubaiDate(), status: dubaiMinutes() > 0 ? 'late' : 'present', checkOutAt: null, isCorrected: false });
    aliRecord = inRec.body.id;
    const stored = await ownerQuery<{ lat: string | null }>(`SELECT check_in_latitude AS lat FROM attendance_records WHERE id = $1`, [aliRecord]);
    expect(stored[0]!.lat).toBeNull(); // location is not kept unless the policy asks for it
    expect((await ali.post('/api/v1/attendance/check-in').send({ photoFileId: await photo(ali) }).expect(409)).body.code).toBe('ALREADY_CHECKED_IN');
    const out = await ali.post('/api/v1/attendance/check-out').send({ photoFileId: await photo(ali) }).expect(200);
    expect(out.body).toMatchObject({ status: 'half_day', checkOutAt: expect.any(String) });
  });

  it('when the policy requires location: missing location and check-ins far from the office are refused', async () => {
    await admin.patch(`/api/v1/attendance-policies/${policyId}`).send({ locationRequired: true, officeLatitude: 25.0772, officeLongitude: 55.1395, officeRadiusM: 300 }).expect(200);
    expect((await mira.post('/api/v1/attendance/check-in').send({ photoFileId: await photo(mira) }).expect(422)).body.code).toBe('LOCATION_REQUIRED');
    expect((await mira.post('/api/v1/attendance/check-in').send({ photoFileId: await photo(mira), latitude: 25.2048, longitude: 55.2708 }).expect(422)).body.code).toBe('OUTSIDE_OFFICE_RADIUS');
    const ok = await mira.post('/api/v1/attendance/check-in').send({ photoFileId: await photo(mira), latitude: 25.0775, longitude: 55.1399 }).expect(201);
    expect(ok.body.status).not.toBe('wfh');
    // Working from home needs no office location.
    const sar = await sara.post('/api/v1/attendance/check-in').send({ photoFileId: await photo(sara), workFromHome: true }).expect(201);
    expect(sar.body.status).toBe('wfh');
    await admin.patch(`/api/v1/attendance-policies/${policyId}`).send({ locationRequired: false, officeLatitude: null, officeLongitude: null, officeRadiusM: null }).expect(200);
  });

  it('records follow the data scope: an agent sees their own; the Admin sees everyone', async () => {
    const own = await ali.get(`/api/v1/attendance/records?from=${dubaiDate()}&to=${dubaiDate()}`).expect(200);
    expect(own.body.data.map((r: { userId: string }) => r.userId)).toEqual([USERS.aliA.id]);
    expect((await ali.get(`/api/v1/attendance/records?userId=${USERS.miraA.id}`).expect(200)).body.data).toEqual([]);
    const all = await admin.get(`/api/v1/attendance/records?from=${dubaiDate()}&to=${dubaiDate()}`).expect(200);
    expect(all.body.data.map((r: { userId: string }) => r.userId).sort()).toEqual([USERS.aliA.id, USERS.saraA.id, USERS.miraA.id].sort());
  });

  it('corrections: the employee asks, a manager approves, the record changes and the original is kept', async () => {
    await mira.post(`/api/v1/attendance/records/${aliRecord}/corrections`).send({ requestedStatus: 'present', reason: 'Not mine' }).expect(404);
    const c = await ali.post(`/api/v1/attendance/records/${aliRecord}/corrections`).send({ requestedStatus: 'present', reason: 'Was at a client viewing in the morning' }).expect(201);
    expect(c.body).toMatchObject({ status: 'pending', originalValues: { status: 'half_day' } });
    await ali.post(`/api/v1/attendance/records/${aliRecord}/corrections`).send({ requestedStatus: 'present', reason: 'again' }).expect(409);
    await ali.post(`/api/v1/attendance/corrections/${c.body.id}/review`).send({ decision: 'approve' }).expect(403);
    const pending = await admin.get('/api/v1/attendance/corrections?status=pending').expect(200);
    expect(pending.body.data.map((x: { id: string }) => x.id)).toContain(c.body.id);
    const approved = await admin.post(`/api/v1/attendance/corrections/${c.body.id}/review`).send({ decision: 'approve', note: 'Confirmed with the client' }).expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', reviewedBy: USERS.adminA.id, originalValues: { status: 'half_day' } });
    const record = (await ali.get(`/api/v1/attendance/records?from=${dubaiDate()}&to=${dubaiDate()}`).expect(200)).body.data[0];
    expect(record).toMatchObject({ status: 'present', isCorrected: true });
  });

  it('leave: allowance, overlap and self-review rules; approval fills the days and stops new leads; cancel frees them', async () => {
    const type = (await admin.post('/api/v1/leave-types').send({ name: 'Spec annual', annualDays: '2' }).expect(201)).body;
    const mon = nextMonday();
    const [d0, d1, d2] = [dubaiDate(mon), dubaiDate(mon + 1), dubaiDate(mon + 2)];
    const tooMany = await ali.post('/api/v1/leave-requests').send({ leaveTypeId: type.id, startDate: d0, endDate: d2 }).expect(400);
    expect(tooMany.body.errors[0].message).toMatch(/2 day\(s\) left/);
    await ali.post('/api/v1/leave-requests').send({ leaveTypeId: type.id, startDate: d0, endDate: d0, isHalfDay: true }).expect(201);
    expect((await ali.post('/api/v1/leave-requests').send({ leaveTypeId: type.id, startDate: d0, endDate: d1 }).expect(409)).body.code).toBe('LEAVE_OVERLAP');
    const req = await ali.post('/api/v1/leave-requests').send({ leaveTypeId: type.id, startDate: d1, endDate: d1, reason: 'Family' }).expect(201);

    const own = await sara.post('/api/v1/leave-requests').send({ leaveTypeId: type.id, startDate: d2, endDate: d2 }).expect(201);
    expect((await sara.post(`/api/v1/leave-requests/${own.body.id}/review`).send({ decision: 'approve' }).expect(422)).body.code).toBe('SELF_REVIEW');

    await ali.post(`/api/v1/leave-requests/${req.body.id}/review`).send({ decision: 'approve' }).expect(403);
    const approved = await admin.post(`/api/v1/leave-requests/${req.body.id}/review`).send({ decision: 'approve' }).expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', reviewedBy: USERS.adminA.id });
    const days = await ownerQuery<{ status: string }>(`SELECT status FROM attendance_records WHERE user_id = $1 AND work_date = $2`, [USERS.aliA.id, d1]);
    expect(days).toEqual([{ status: 'leave' }]);

    const leave = app.get(LeaveService);
    const onLeave = await app.get(DbService).withTenant(TENANT_A, () => leave.onLeave([USERS.aliA.id, USERS.miraA.id], d1));
    expect([...onLeave]).toEqual([USERS.aliA.id]);

    await mira.post(`/api/v1/leave-requests/${req.body.id}/cancel`).expect(404);
    await ali.post(`/api/v1/leave-requests/${req.body.id}/cancel`).expect(200);
    expect(await ownerQuery(`SELECT 1 FROM attendance_records WHERE user_id = $1 AND work_date = $2`, [USERS.aliA.id, d1])).toEqual([]);
    const mine = await ali.get(`/api/v1/leave-requests?from=${d0}&to=${d2}`).expect(200);
    expect(mine.body.data.every((l: { userId: string }) => l.userId === USERS.aliA.id)).toBe(true);
  });

  it('holidays: added by settings.manage; the close of day marks absentees only on working days', async () => {
    const holiday = await admin.post('/api/v1/holidays').send({ holidayDate: dubaiDate(30), name: 'Spec holiday' }).expect(201);
    await admin.post('/api/v1/holidays').send({ holidayDate: dubaiDate(30), name: 'Again' }).expect(409);
    await admin.delete(`/api/v1/holidays/${holiday.body.id}`).expect(204);

    await app.get(QueueService).runNow('attendance-close-day');
    const rows = await ownerQuery<{ status: string }>(`SELECT status FROM attendance_records WHERE user_id = $1 AND work_date = $2`, [USERS.adminA.id, dubaiDate()]);
    const weekend = [0, 6].includes(new Date(`${dubaiDate()}T12:00:00Z`).getUTCDay());
    expect(rows).toEqual(weekend ? [] : [{ status: 'absent' }]);
    // People who checked in keep their status.
    const ali2 = await ownerQuery<{ status: string }>(`SELECT status FROM attendance_records WHERE user_id = $1 AND work_date = $2`, [USERS.aliA.id, dubaiDate()]);
    expect(ali2).toEqual([{ status: 'present' }]);
  });

  it('the monthly attendance report counts days per employee, follows the scope, and only Admin exports it', async () => {
    const report = (await admin.get(`/api/v1/reports/attendance_monthly?from=${dubaiDate(-1)}&to=${dubaiDate(1)}`).expect(200)).body;
    const aliRow = report.rows.find((r: { userId: string }) => r.userId === USERS.aliA.id);
    expect(aliRow).toMatchObject({ employee: 'Ali', present: 1, corrected: 1 });
    expect(report.rows.find((r: { userId: string }) => r.userId === USERS.saraA.id)).toMatchObject({ wfh: 1 });
    const own = (await ali.get(`/api/v1/reports/attendance_monthly?from=${dubaiDate(-1)}&to=${dubaiDate(1)}`).expect(200)).body;
    expect(own.rows.map((r: { userId: string }) => r.userId)).toEqual([USERS.aliA.id]);
    await ali.post('/api/v1/reports/attendance_monthly/exports').send({ format: 'xlsx', filters: {} }).expect(403);
    const exp = await admin.post('/api/v1/reports/attendance_monthly/exports').send({ format: 'xlsx', filters: { from: dubaiDate(-1), to: dubaiDate(1) } }).expect(202);
    // Run the export here, so no job is left in the shared queue for other test files.
    expect(await app.get(QueueService).drain('report-export')).toBe(1);
    expect((await admin.get(`/api/v1/exports/${exp.body.id}`).expect(200)).body).toMatchObject({ status: 'completed', rowCount: report.rows.length });
  });
});
