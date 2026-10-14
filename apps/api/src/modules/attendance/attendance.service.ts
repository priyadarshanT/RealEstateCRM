import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { WorkerDbService } from '../../core/database/worker-db.service';
import { pgCode, PG_FOREIGN_KEY_VIOLATION } from '../../core/errors/pg';
import { ProblemException, Problems } from '../../core/errors/problem';
import { decodeCursor, Page, toPage } from '../../core/http/pagination';
import { QueueService } from '../../core/queue/queue.service';
import { OrganizationDirectory } from '../organization/directory.service';
import { attendanceCorrections, attendancePolicies, attendanceRecords, CorrectionRow, DayStatus, RecordRow } from './attendance.schema';
import { AttendanceRecordDto, CheckInDto, CorrectionDto, CorrectionInputDto, CorrectionListQuery, RecordListQuery, ReviewDto } from './dto/attendance.dto';
import { distanceM, EffectivePolicy, localDate, localMinutes, minutesOf, PoliciesService, weekday } from './policies.service';

/**
 * Daily attendance (SRS §9.1–9.4): check in and out on the phone with a live photo and the time; location only when
 * the company's policy asks for it. The status (present, late, half day, work from home) follows the policy.
 * Employees ask for corrections; managers approve, and both the original and corrected entries are kept.
 * Who sees whose attendance follows the user's data scope (own, team, division, company).
 */
@Injectable()
export class AttendanceService implements OnModuleInit {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly db: DbService,
    private readonly workerDb: WorkerDbService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly policies: PoliciesService,
    private readonly directory: OrganizationDirectory,
  ) {}

  onModuleInit(): void {
    this.queue.register('attendance-close-day', () => this.closeDay(), { cron: '45 23 * * *' });
  }

  // ---------------------------------------------------------------- check in / out
  async checkIn(p: Principal, body: CheckInDto): Promise<RecordRow> {
    const tz = await this.policies.timeZone();
    const now = new Date();
    const today = localDate(now, tz);
    const policy = await this.policies.effective();
    const location = this.location(policy, body);
    const [existing] = await this.db.current.select().from(attendanceRecords).where(and(eq(attendanceRecords.userId, p.userId), eq(attendanceRecords.workDate, today))).limit(1);
    if (existing?.checkInAt) throw new ProblemException(409, 'ALREADY_CHECKED_IN', 'Already checked in', 'You already checked in today.');
    const late = localMinutes(now, tz) > minutesOf(policy.workStart) + policy.graceMinutes;
    const status: DayStatus = body.workFromHome ? 'wfh' : late ? 'late' : 'present';
    const values = { status, checkInAt: now, checkInPhotoFileId: body.photoFileId, checkInLatitude: location?.lat ?? null, checkInLongitude: location?.lon ?? null, source: 'app' as const, updatedAt: now };
    const [row] = await (existing
      ? this.db.current.update(attendanceRecords).set({ ...values, leaveRequestId: null }).where(eq(attendanceRecords.id, existing.id)).returning()
      : this.db.current.insert(attendanceRecords).values({ tenantId: p.tenantId, userId: p.userId, workDate: today, ...values }).returning()
    ).catch(photoMissing);
    return row!;
  }

  /** Check-out: worked time at or below the policy's half-day limit makes the day a Half Day. */
  async checkOut(p: Principal, body: CheckInDto): Promise<RecordRow> {
    const tz = await this.policies.timeZone();
    const now = new Date();
    const policy = await this.policies.effective();
    const location = this.location(policy, body);
    const [record] = await this.db.current.select().from(attendanceRecords).where(and(eq(attendanceRecords.userId, p.userId), eq(attendanceRecords.workDate, localDate(now, tz)))).limit(1);
    if (!record?.checkInAt) throw new ProblemException(409, 'NOT_CHECKED_IN', 'Not checked in', 'Check in first.');
    if (record.checkOutAt) throw new ProblemException(409, 'CONFLICT', 'Already checked out', 'You already checked out today.');
    const worked = (now.getTime() - record.checkInAt.getTime()) / 60_000;
    const status: DayStatus = record.status === 'wfh' ? 'wfh' : worked <= policy.halfDayMaxMinutes ? 'half_day' : record.status;
    const [row] = await this.db.current
      .update(attendanceRecords)
      .set({ status, checkOutAt: now, checkOutPhotoFileId: body.photoFileId, checkOutLatitude: location?.lat ?? null, checkOutLongitude: location?.lon ?? null, updatedAt: now })
      .where(eq(attendanceRecords.id, record.id))
      .returning()
      .catch(photoMissing);
    return row!;
  }

  // ---------------------------------------------------------------- records
  async list(p: Principal, q: RecordListQuery): Promise<Page<AttendanceRecordDto>> {
    const visible = await this.visibleUserIds(p);
    let users = visible;
    if (q.teamId) {
      const members = (await this.directory.teamMembers(q.teamId)).map((u) => u.id);
      users = visible ? visible.filter((id) => members.includes(id)) : members;
    }
    if (q.userId) users = !users || users.includes(q.userId) ? [q.userId] : [];
    if (users && !users.length) return { data: [], page: { nextCursor: null, hasMore: false } };
    const after = q.cursor ? (([d, id]) => sql`(${attendanceRecords.workDate}, ${attendanceRecords.id}) < (${d}::date, ${id}::uuid)`)(decodeCursor(q.cursor, 2) as [string, string]) : undefined;
    const rows = await this.db.current
      .select()
      .from(attendanceRecords)
      .where(
        and(
          after,
          users ? inArray(attendanceRecords.userId, users) : undefined,
          q.from ? gte(attendanceRecords.workDate, q.from) : undefined,
          q.to ? lte(attendanceRecords.workDate, q.to) : undefined,
          q.status ? eq(attendanceRecords.status, q.status) : undefined,
        ),
      )
      .orderBy(desc(attendanceRecords.workDate), desc(attendanceRecords.id))
      .limit(q.limit + 1);
    return toPage(rows, q.limit, (r) => [r.workDate, r.id], AttendanceRecordDto.from);
  }

  /** Records of a period for reports (no scope check; the caller checks who may see them). */
  async recordsBetween(from: string, to: string, userIds?: string[]): Promise<RecordRow[]> {
    return this.db.current
      .select()
      .from(attendanceRecords)
      .where(and(gte(attendanceRecords.workDate, from), lte(attendanceRecords.workDate, to), userIds ? inArray(attendanceRecords.userId, userIds) : undefined));
  }

  /**
   * Days per status for each employee the principal may see (monthly attendance report, SRS §9.5); employees
   * without a record in the period still appear with zeros.
   */
  async summary(p: Principal, from: string, to: string, teamId?: string, userId?: string) {
    let users = await this.visibleUserIds(p);
    const people = teamId ? await this.directory.teamMembers(teamId) : (await this.directory.all()).filter((u) => u.status === 'active');
    let ids = people.map((u) => u.id);
    if (users) ids = ids.filter((id) => users!.includes(id));
    if (userId) ids = ids.filter((id) => id === userId);
    users = ids;
    if (!ids.length) return [];
    const rows = await this.recordsBetween(from, to, ids);
    const empty = () => ({ present: 0, late: 0, absent: 0, leave: 0, half_day: 0, wfh: 0, corrected: 0 });
    const byUser = new Map(ids.map((id) => [id, empty()]));
    for (const r of rows) {
      const s = byUser.get(r.userId)!;
      s[r.status] += 1;
      if (r.isCorrected) s.corrected += 1;
    }
    return people.filter((u) => byUser.has(u.id)).map((u) => ({ userId: u.id, name: u.fullName, teamId: u.teamId, ...byUser.get(u.id)! }));
  }

  // ---------------------------------------------------------------- corrections
  /** An employee asks to correct their own record; the record is not changed until a manager approves. */
  async requestCorrection(p: Principal, recordId: string, body: CorrectionInputDto): Promise<CorrectionRow> {
    const [record] = await this.db.current.select().from(attendanceRecords).where(eq(attendanceRecords.id, recordId)).limit(1);
    if (!record || record.userId !== p.userId) throw Problems.notFound();
    if (body.requestedStatus === 'leave') throw Problems.validation([{ field: 'requestedStatus', message: 'request leave with a leave request' }]);
    const checkIn = body.requestedCheckInAt !== undefined ? body.requestedCheckInAt : record.checkInAt?.toISOString() ?? null;
    const checkOut = body.requestedCheckOutAt !== undefined ? body.requestedCheckOutAt : record.checkOutAt?.toISOString() ?? null;
    if (checkOut && (!checkIn || new Date(checkOut) <= new Date(checkIn))) throw Problems.validation([{ field: 'requestedCheckOutAt', message: 'must be after the check-in time' }]);
    const [pending] = await this.db.current
      .select({ id: attendanceCorrections.id })
      .from(attendanceCorrections)
      .where(and(eq(attendanceCorrections.recordId, recordId), eq(attendanceCorrections.status, 'pending')))
      .limit(1);
    if (pending) throw new ProblemException(409, 'CONFLICT', 'Already requested', 'A correction for this day is waiting for review.');
    const [row] = await this.db.current
      .insert(attendanceCorrections)
      .values({
        tenantId: p.tenantId,
        recordId,
        requestedBy: p.userId,
        originalValues: snapshot(record),
        requestedStatus: body.requestedStatus,
        requestedCheckInAt: body.requestedCheckInAt ? new Date(body.requestedCheckInAt) : null,
        requestedCheckOutAt: body.requestedCheckOutAt ? new Date(body.requestedCheckOutAt) : null,
        reason: body.reason.trim(),
      })
      .returning();
    return row!;
  }

  async listCorrections(p: Principal, q: CorrectionListQuery): Promise<Page<CorrectionDto>> {
    const visible = await this.visibleUserIds(p);
    const after = q.cursor ? (([at, id]) => sql`(${attendanceCorrections.createdAt}, ${attendanceCorrections.id}) < (${at}::timestamptz, ${id}::uuid)`)(decodeCursor(q.cursor, 2) as [string, string]) : undefined;
    const rows = await this.db.current
      .select()
      .from(attendanceCorrections)
      .where(and(after, visible ? inArray(attendanceCorrections.requestedBy, visible) : undefined, q.status ? eq(attendanceCorrections.status, q.status) : undefined))
      .orderBy(desc(attendanceCorrections.createdAt), desc(attendanceCorrections.id))
      .limit(q.limit + 1);
    return toPage(rows, q.limit, (r) => [r.createdAt.toISOString(), r.id], CorrectionDto.from);
  }

  /** A manager approves or rejects; approval updates the record (source "correction"), the original stays on the request. */
  async reviewCorrection(p: Principal, id: string, body: ReviewDto): Promise<CorrectionRow> {
    const [c] = await this.db.current.select().from(attendanceCorrections).where(eq(attendanceCorrections.id, id)).limit(1);
    const visible = await this.visibleUserIds(p);
    if (!c || (visible && !visible.includes(c.requestedBy))) throw Problems.notFound();
    if (c.requestedBy === p.userId) throw new ProblemException(422, 'SELF_REVIEW', 'Own request', 'Someone else has to review your own request.');
    if (c.status !== 'pending') throw new ProblemException(409, 'CONFLICT', 'Already reviewed', `The request was ${c.status}.`);
    const status = body.decision === 'approve' ? 'approved' : 'rejected';
    const [after] = await this.db.current
      .update(attendanceCorrections)
      .set({ status, reviewedBy: p.userId, reviewedAt: new Date(), reviewNote: body.note?.trim() || null })
      .where(eq(attendanceCorrections.id, id))
      .returning();
    if (status === 'approved') {
      const [record] = await this.db.current.select().from(attendanceRecords).where(eq(attendanceRecords.id, c.recordId)).limit(1);
      await this.db.current
        .update(attendanceRecords)
        .set({
          status: c.requestedStatus,
          checkInAt: c.requestedCheckInAt ?? record!.checkInAt,
          checkOutAt: c.requestedCheckOutAt ?? record!.checkOutAt,
          leaveRequestId: null,
          source: 'correction',
          isCorrected: true,
          updatedAt: new Date(),
        })
        .where(eq(attendanceRecords.id, c.recordId));
      await this.audit.record('update', 'attendance_records', c.recordId, { status: [record!.status, c.requestedStatus] });
    }
    await this.audit.record('update', 'attendance_corrections', id, { status: ['pending', status] });
    return after!;
  }

  // ---------------------------------------------------------------- jobs and helpers
  /**
   * attendance-close-day (23:45 daily): on a working day, employees with no record are marked Absent. Runs for
   * companies that use attendance (a policy or any record).
   */
  async closeDay(): Promise<void> {
    const tenants = await this.workerDb.db.execute(
      sql`SELECT tenant_id FROM ${attendancePolicies} UNION SELECT DISTINCT tenant_id FROM ${attendanceRecords}`,
    );
    for (const { tenant_id: tenantId } of tenants.rows as { tenant_id: string }[]) {
      try {
        await this.db.withTenant(tenantId, async () => {
          const today = localDate(new Date(), await this.policies.timeZone());
          const policy = await this.policies.effective();
          if (policy.weekendDays.includes(weekday(today)) || (await this.policies.holidayDates(today, today)).size) return;
          const people = (await this.directory.all()).filter((u) => u.status === 'active');
          if (!people.length) return;
          await this.db.current
            .insert(attendanceRecords)
            .values(people.map((u) => ({ tenantId, userId: u.id, workDate: today, status: 'absent' as const, source: 'system' as const })))
            .onConflictDoNothing();
        });
      } catch (err) {
        this.logger.error(`close-day for tenant ${tenantId} failed: ${(err as Error).message}`);
      }
    }
  }

  /** User IDs the principal may see: undefined = everyone (company scope). */
  async visibleUserIds(p: Principal): Promise<string[] | undefined> {
    if (p.dataScope === 'company') return undefined;
    if (p.dataScope === 'own') return [p.userId];
    const teamIds = await this.directory.scopeTeamIds(p.userId, p.dataScope);
    const me = await this.directory.user(p.userId);
    if (me?.teamId && !teamIds.includes(me.teamId)) teamIds.push(me.teamId);
    const members = (await Promise.all(teamIds.map((t) => this.directory.teamMembers(t)))).flat().map((u) => u.id);
    return [...new Set([p.userId, ...members])];
  }

  /** Location is kept only when the policy asks for it (and then it is required, within the office radius). */
  private location(policy: EffectivePolicy, body: CheckInDto): { lat: string; lon: string } | undefined {
    if (!policy.locationRequired || body.workFromHome) return undefined;
    if (body.latitude === undefined || body.longitude === undefined) {
      throw new ProblemException(422, 'LOCATION_REQUIRED', 'Location required', 'Allow location on your phone to check in.');
    }
    if (policy.officeLatitude !== null && policy.officeLongitude !== null && policy.officeRadiusM !== null) {
      const d = distanceM(body.latitude, body.longitude, Number(policy.officeLatitude), Number(policy.officeLongitude));
      if (d > policy.officeRadiusM) throw new ProblemException(422, 'OUTSIDE_OFFICE_RADIUS', 'Outside the office', `You are ${Math.round(d)} m from the office (allowed ${policy.officeRadiusM} m).`);
    }
    return { lat: String(body.latitude), lon: String(body.longitude) };
  }
}

function snapshot(r: RecordRow): Record<string, unknown> {
  return { status: r.status, checkInAt: r.checkInAt?.toISOString() ?? null, checkOutAt: r.checkOutAt?.toISOString() ?? null, source: r.source, isCorrected: r.isCorrected };
}

function photoMissing(err: unknown): never {
  if (pgCode(err) === PG_FOREIGN_KEY_VIOLATION) throw Problems.validation([{ field: 'photoFileId', message: 'photo not found; upload it first' }]);
  throw err;
}
