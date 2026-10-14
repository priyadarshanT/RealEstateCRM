import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { pgCode } from '../../core/errors/pg';
import { ProblemException, Problems } from '../../core/errors/problem';
import { decodeCursor, Page, toPage } from '../../core/http/pagination';
import { NotificationsService } from '../notifications/notifications.service';
import { attendanceRecords, leaveRequests, LeaveRequestRow } from './attendance.schema';
import { AttendanceService } from './attendance.service';
import { LeaveListQuery, LeaveRequestDto, LeaveRequestInputDto, ReviewDto } from './dto/attendance.dto';
import { datesBetween, localDate, PoliciesService, weekday } from './policies.service';

const PG_EXCLUSION_VIOLATION = '23P01';
const overlap = () => new ProblemException(409, 'LEAVE_OVERLAP', 'Leave overlaps', 'These dates overlap leave that is already requested or approved.');

/**
 * Leave (SRS §9.2–9.3, §9.6): employees request leave, managers approve or reject (never their own). Approved leave
 * fills the attendance days with Leave and stops new leads for those days; the yearly allowance of each leave type
 * counts working days only (weekends and holidays are not counted).
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly policies: PoliciesService,
    private readonly attendance: AttendanceService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(p: Principal, q: LeaveListQuery): Promise<Page<LeaveRequestDto>> {
    const visible = await this.attendance.visibleUserIds(p);
    if (q.userId && visible && !visible.includes(q.userId)) return { data: [], page: { nextCursor: null, hasMore: false } };
    const after = q.cursor ? (([d, id]) => sql`(${leaveRequests.startDate}, ${leaveRequests.id}) < (${d}::date, ${id}::uuid)`)(decodeCursor(q.cursor, 2) as [string, string]) : undefined;
    const rows = await this.db.current
      .select()
      .from(leaveRequests)
      .where(
        and(
          after,
          visible ? inArray(leaveRequests.userId, visible) : undefined,
          q.userId ? eq(leaveRequests.userId, q.userId) : undefined,
          q.status ? eq(leaveRequests.status, q.status) : undefined,
          q.from ? gte(leaveRequests.endDate, q.from) : undefined,
          q.to ? lte(leaveRequests.startDate, q.to) : undefined,
        ),
      )
      .orderBy(desc(leaveRequests.startDate), desc(leaveRequests.id))
      .limit(q.limit + 1);
    return toPage(rows, q.limit, (r) => [r.startDate, r.id], LeaveRequestDto.from);
  }

  async request(p: Principal, body: LeaveRequestInputDto): Promise<LeaveRequestRow> {
    const type = await this.policies.getLeaveType(body.leaveTypeId).catch(() => undefined);
    const errors: { field: string; message: string }[] = [];
    if (!type || !type.isActive) errors.push({ field: 'leaveTypeId', message: 'choose an active leave type' });
    if (body.endDate < body.startDate) errors.push({ field: 'endDate', message: 'must be on or after the start date' });
    if (body.isHalfDay && body.endDate !== body.startDate) errors.push({ field: 'isHalfDay', message: 'a half day is one date' });
    if (errors.length) throw Problems.validation(errors);
    const days = await this.workingDays(body.startDate, body.endDate, body.isHalfDay ?? false);
    if (days === 0) throw Problems.validation([{ field: 'startDate', message: 'these dates are all weekend or holidays' }]);
    const [clash] = await this.db.current
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.userId, p.userId), inArray(leaveRequests.status, ['pending', 'approved']), lte(leaveRequests.startDate, body.endDate), gte(leaveRequests.endDate, body.startDate)))
      .limit(1);
    if (clash) throw overlap();
    if (type!.annualDays !== null) {
      const year = body.startDate.slice(0, 4);
      const used = await this.daysTaken(p.userId, type!.id, year);
      if (used + days > Number(type!.annualDays)) {
        throw Problems.validation([{ field: 'endDate', message: `${type!.name}: ${Number(type!.annualDays) - used} day(s) left this year` }]);
      }
    }
    const [row] = await this.db.current
      .insert(leaveRequests)
      .values({ tenantId: p.tenantId, userId: p.userId, leaveTypeId: type!.id, startDate: body.startDate, endDate: body.endDate, isHalfDay: body.isHalfDay ?? false, reason: body.reason ?? null })
      .returning();
    await this.audit.record('create', 'leave_requests', row!.id, { startDate: [null, row!.startDate], endDate: [null, row!.endDate] });
    return row!;
  }

  async review(p: Principal, id: string, body: ReviewDto): Promise<LeaveRequestRow> {
    const before = await this.visibleRequest(p, id);
    if (before.userId === p.userId) throw new ProblemException(422, 'SELF_REVIEW', 'Own request', 'Someone else has to review your own request.');
    if (before.status !== 'pending') throw new ProblemException(409, 'CONFLICT', 'Already reviewed', `The request is ${before.status}.`);
    const status = body.decision === 'approve' ? 'approved' : 'rejected';
    const [after] = await this.db.current
      .update(leaveRequests)
      .set({ status, reviewedBy: p.userId, reviewedAt: new Date(), reviewNote: body.note?.trim() || null })
      .where(eq(leaveRequests.id, id))
      .returning()
      .catch((err: unknown) => {
        if (pgCode(err) === PG_EXCLUSION_VIOLATION) throw overlap();
        throw err;
      });
    if (status === 'approved') await this.fillLeaveDays(after!);
    await this.notifications.notify({
      userId: before.userId,
      type: status === 'approved' ? 'leave_approved' : 'leave_rejected',
      title: `Leave ${before.startDate}${before.endDate !== before.startDate ? ` to ${before.endDate}` : ''} ${status}`,
      body: body.note?.trim() || null,
    });
    await this.audit.record('update', 'leave_requests', id, { status: ['pending', status] });
    return after!;
  }

  /** The employee cancels their own request; approved days not started yet are freed again. */
  async cancel(p: Principal, id: string): Promise<LeaveRequestRow> {
    const [before] = await this.db.current.select().from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
    if (!before || before.userId !== p.userId) throw Problems.notFound();
    if (before.status !== 'pending' && before.status !== 'approved') throw new ProblemException(409, 'CONFLICT', 'Cannot cancel', `The request is ${before.status}.`);
    const [after] = await this.db.current.update(leaveRequests).set({ status: 'cancelled' }).where(eq(leaveRequests.id, id)).returning();
    // Leave days written by the system for this request (no check-in) are removed.
    await this.db.current
      .delete(attendanceRecords)
      .where(and(eq(attendanceRecords.leaveRequestId, id), eq(attendanceRecords.source, 'system'), isNull(attendanceRecords.checkInAt)));
    await this.audit.record('update', 'leave_requests', id, { status: [before.status, 'cancelled'] });
    return after!;
  }

  /** Users on approved leave on a date (assignment skips them, SRS §9.6). */
  async onLeave(userIds: string[], date?: string): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const day = date ?? localDate(new Date(), await this.policies.timeZone());
    const rows = await this.db.current
      .select({ userId: leaveRequests.userId })
      .from(leaveRequests)
      .where(and(inArray(leaveRequests.userId, userIds), eq(leaveRequests.status, 'approved'), lte(leaveRequests.startDate, day), gte(leaveRequests.endDate, day), eq(leaveRequests.isHalfDay, false)));
    return new Set(rows.map((r) => r.userId));
  }

  private async visibleRequest(p: Principal, id: string): Promise<LeaveRequestRow> {
    const [row] = await this.db.current.select().from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
    const visible = await this.attendance.visibleUserIds(p);
    if (!row || (visible && !visible.includes(row.userId))) throw Problems.notFound();
    return row;
  }

  /** Working days of a period under the company policy (half day = 0.5). */
  private async workingDays(start: string, end: string, halfDay: boolean): Promise<number> {
    const policy = await this.policies.effective();
    const holidays = await this.policies.holidayDates(start, end);
    const days = datesBetween(start, end).filter((d) => !policy.weekendDays.includes(weekday(d)) && !holidays.has(d)).length;
    return halfDay ? Math.min(days, 1) * 0.5 : days;
  }

  /** Days of a leave type already requested or approved in a year. */
  private async daysTaken(userId: string, leaveTypeId: string, year: string): Promise<number> {
    const rows = await this.db.current
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.userId, userId),
          eq(leaveRequests.leaveTypeId, leaveTypeId),
          inArray(leaveRequests.status, ['pending', 'approved']),
          gte(leaveRequests.endDate, `${year}-01-01`),
          lte(leaveRequests.startDate, `${year}-12-31`),
        ),
      );
    let total = 0;
    for (const r of rows) total += await this.workingDays(r.startDate < `${year}-01-01` ? `${year}-01-01` : r.startDate, r.endDate > `${year}-12-31` ? `${year}-12-31` : r.endDate, r.isHalfDay);
    return total;
  }

  /** Approved leave: each working day becomes a Leave (or Half Day) record unless the employee already checked in. */
  private async fillLeaveDays(r: LeaveRequestRow): Promise<void> {
    const policy = await this.policies.effective();
    const holidays = await this.policies.holidayDates(r.startDate, r.endDate);
    const days = datesBetween(r.startDate, r.endDate).filter((d) => !policy.weekendDays.includes(weekday(d)) && !holidays.has(d));
    for (const day of days) {
      const values = { status: (r.isHalfDay ? 'half_day' : 'leave') as 'half_day' | 'leave', leaveRequestId: r.id, source: 'system' as const, updatedAt: new Date() };
      const updated = await this.db.current
        .update(attendanceRecords)
        .set(values)
        .where(and(eq(attendanceRecords.userId, r.userId), eq(attendanceRecords.workDate, day), isNull(attendanceRecords.checkInAt), ne(attendanceRecords.source, 'correction')))
        .returning({ id: attendanceRecords.id });
      if (!updated.length) {
        await this.db.current.insert(attendanceRecords).values({ tenantId: r.tenantId, userId: r.userId, workDate: day, ...values }).onConflictDoNothing();
      }
    }
  }
}
