import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, lte, ne, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { DbService } from '../../core/database/db.service';
import { isStillReferenced, pgCode, PG_UNIQUE_VIOLATION } from '../../core/errors/pg';
import { ProblemException, Problems } from '../../core/errors/problem';
import { versionConflict } from '../../core/http/etag';
import { decodeCursor, Page, toPage } from '../../core/http/pagination';
import { OrganizationService } from '../organization/organization.service';
import { attendancePolicies, holidays, HolidayRow, leaveTypes, LeaveTypeRow, PolicyRow } from './attendance.schema';
import { AttendancePolicyDto, AttendancePolicyInputDto, HolidayDto, HolidayInputDto, LeaveTypeDto, LeaveTypeInputDto } from './dto/attendance.dto';

/** Office hours used until the Admin sets a policy: 09:00–18:00, 10 minutes grace, Saturday and Sunday off. */
export const BUILT_IN_POLICY: Pick<PolicyRow, 'workStart' | 'workEnd' | 'graceMinutes' | 'halfDayMaxMinutes' | 'weekendDays' | 'locationRequired' | 'officeLatitude' | 'officeLongitude' | 'officeRadiusM'> = {
  workStart: '09:00:00',
  workEnd: '18:00:00',
  graceMinutes: 10,
  halfDayMaxMinutes: 300,
  weekendDays: [0, 6],
  locationRequired: false,
  officeLatitude: null,
  officeLongitude: null,
  officeRadiusM: null,
};
export type EffectivePolicy = typeof BUILT_IN_POLICY;

/** Office hours, grace time, weekends, location rules, holidays and leave types (SRS §9.3). */
@Injectable()
export class PoliciesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly organization: OrganizationService,
  ) {}

  // ---------------------------------------------------------------- policies
  async listPolicies(limit: number, cursor?: string): Promise<Page<AttendancePolicyDto>> {
    const after = cursor ? (([n, id]) => sql`(${attendancePolicies.name}, ${attendancePolicies.id}) > (${n}, ${id}::uuid)`)(decodeCursor(cursor, 2) as [string, string]) : undefined;
    const rows = await this.db.current.select().from(attendancePolicies).where(after).orderBy(asc(attendancePolicies.name), asc(attendancePolicies.id)).limit(limit + 1);
    return toPage(rows, limit, (r) => [r.name, r.id], AttendancePolicyDto.from);
  }

  async getPolicy(id: string): Promise<PolicyRow> {
    const [row] = await this.db.current.select().from(attendancePolicies).where(eq(attendancePolicies.id, id)).limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }

  async createPolicy(body: AttendancePolicyInputDto): Promise<PolicyRow> {
    const missing = (['name', 'workStart', 'workEnd'] as const).filter((f) => !body[f]);
    if (missing.length) throw Problems.validation(missing.map((field) => ({ field, message: `${field} is required` })));
    const values = policyFields(body);
    checkPolicy({ ...BUILT_IN_POLICY, ...values });
    const [{ n }] = (await this.db.current.select({ n: sql<number>`count(*)::int` }).from(attendancePolicies)) as [{ n: number }];
    const isDefault = body.isDefault ?? n === 0; // the first policy is the default
    if (isDefault) await this.db.current.update(attendancePolicies).set({ isDefault: false }).where(eq(attendancePolicies.isDefault, true));
    const [row] = await this.db.current
      .insert(attendancePolicies)
      .values({ tenantId: this.db.currentTenantId!, name: body.name!.trim(), weekendDays: BUILT_IN_POLICY.weekendDays, ...values, workStart: body.workStart!, workEnd: body.workEnd!, isDefault })
      .returning()
      .catch(rethrow('policy'));
    await this.audit.record('create', 'attendance_policies', row!.id, { name: [null, row!.name] });
    return row!;
  }

  async updatePolicy(id: string, body: AttendancePolicyInputDto, expectedVersion?: string): Promise<PolicyRow> {
    const before = await this.getPolicy(id);
    const values = policyFields(body);
    checkPolicy({ ...before, ...values });
    if (body.isDefault === true && !before.isDefault) await this.db.current.update(attendancePolicies).set({ isDefault: false }).where(and(eq(attendancePolicies.isDefault, true), ne(attendancePolicies.id, id)));
    if (body.isDefault === false && before.isDefault) throw Problems.validation([{ field: 'isDefault', message: 'make another policy the default instead' }]);
    const [after] = await this.db.current
      .update(attendancePolicies)
      .set({ ...values, ...(body.name ? { name: body.name.trim() } : {}), ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}) })
      .where(and(eq(attendancePolicies.id, id), expectedVersion ? eq(attendancePolicies.updatedAt, expectedVersion) : undefined))
      .returning()
      .catch(rethrow('policy'));
    if (!after) throw versionConflict();
    await this.audit.recordUpdate('attendance_policies', id, AttendancePolicyDto.from(before), AttendancePolicyDto.from(after));
    return after;
  }

  async deletePolicy(id: string): Promise<void> {
    const row = await this.getPolicy(id);
    if (row.isDefault) throw new ProblemException(409, 'CONFLICT', 'Default policy', 'Make another policy the default before deleting this one.');
    await this.db.current.delete(attendancePolicies).where(eq(attendancePolicies.id, id)).catch(rethrow('policy'));
    await this.audit.record('delete', 'attendance_policies', id, { name: [row.name, null] });
  }

  /** The company's default policy, or the built-in office hours until one is set. */
  async effective(): Promise<EffectivePolicy> {
    const [row] = await this.db.current.select().from(attendancePolicies).where(eq(attendancePolicies.isDefault, true)).limit(1);
    return row ?? BUILT_IN_POLICY;
  }

  // ---------------------------------------------------------------- holidays
  async listHolidays(limit: number, cursor?: string): Promise<Page<HolidayDto>> {
    const after = cursor ? (([d, id]) => sql`(${holidays.holidayDate}, ${holidays.id}) > (${d}::date, ${id}::uuid)`)(decodeCursor(cursor, 2) as [string, string]) : undefined;
    const rows = await this.db.current.select().from(holidays).where(after).orderBy(asc(holidays.holidayDate), asc(holidays.id)).limit(limit + 1);
    return toPage(rows, limit, (r) => [r.holidayDate, r.id], HolidayDto.from);
  }

  async createHoliday(body: HolidayInputDto): Promise<HolidayRow> {
    const [row] = await this.db.current
      .insert(holidays)
      .values({ tenantId: this.db.currentTenantId!, holidayDate: body.holidayDate, name: body.name.trim() })
      .returning()
      .catch((err: unknown) => {
        if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ProblemException(409, 'CONFLICT', 'Already a holiday', 'There is already a holiday on this date.');
        throw err;
      });
    await this.audit.record('create', 'holidays', row!.id, { holidayDate: [null, row!.holidayDate], name: [null, row!.name] });
    return row!;
  }

  async deleteHoliday(id: string): Promise<void> {
    const [row] = await this.db.current.delete(holidays).where(eq(holidays.id, id)).returning();
    if (!row) throw Problems.notFound();
    await this.audit.record('delete', 'holidays', id, { holidayDate: [row.holidayDate, null] });
  }

  /** Holiday dates in a period (YYYY-MM-DD). */
  async holidayDates(from: string, to: string): Promise<Set<string>> {
    const rows = await this.db.current.select({ d: holidays.holidayDate }).from(holidays).where(and(gte(holidays.holidayDate, from), lte(holidays.holidayDate, to)));
    return new Set(rows.map((r) => r.d));
  }

  // ---------------------------------------------------------------- leave types
  async listLeaveTypes(limit: number, cursor?: string): Promise<Page<LeaveTypeDto>> {
    const after = cursor ? (([n, id]) => sql`(${leaveTypes.name}, ${leaveTypes.id}) > (${n}, ${id}::uuid)`)(decodeCursor(cursor, 2) as [string, string]) : undefined;
    const rows = await this.db.current.select().from(leaveTypes).where(after).orderBy(asc(leaveTypes.name), asc(leaveTypes.id)).limit(limit + 1);
    return toPage(rows, limit, (r) => [r.name, r.id], LeaveTypeDto.from);
  }

  async getLeaveType(id: string): Promise<LeaveTypeRow> {
    const [row] = await this.db.current.select().from(leaveTypes).where(eq(leaveTypes.id, id)).limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }

  async createLeaveType(body: LeaveTypeInputDto): Promise<LeaveTypeRow> {
    if (!body.name?.trim()) throw Problems.validation([{ field: 'name', message: 'name is required' }]);
    const [row] = await this.db.current
      .insert(leaveTypes)
      .values({ tenantId: this.db.currentTenantId!, name: body.name.trim(), annualDays: body.annualDays ?? null, isPaid: body.isPaid ?? true, isActive: body.isActive ?? true })
      .returning()
      .catch(rethrow('leave type'));
    await this.audit.record('create', 'leave_types', row!.id, { name: [null, row!.name] });
    return row!;
  }

  async updateLeaveType(id: string, body: LeaveTypeInputDto): Promise<LeaveTypeRow> {
    const before = await this.getLeaveType(id);
    const [after] = await this.db.current
      .update(leaveTypes)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.annualDays !== undefined ? { annualDays: body.annualDays } : {}),
        ...(body.isPaid !== undefined ? { isPaid: body.isPaid } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      })
      .where(eq(leaveTypes.id, id))
      .returning()
      .catch(rethrow('leave type'));
    await this.audit.recordUpdate('leave_types', id, LeaveTypeDto.from(before), LeaveTypeDto.from(after!));
    return after!;
  }

  /** A leave type already used by requests cannot be deleted; switch it off (isActive) instead. */
  async deleteLeaveType(id: string): Promise<void> {
    const row = await this.getLeaveType(id);
    await this.db.current.delete(leaveTypes).where(eq(leaveTypes.id, id)).catch(rethrow('leave type'));
    await this.audit.record('delete', 'leave_types', id, { name: [row.name, null] });
  }

  async timeZone(): Promise<string> {
    return (await this.organization.getProfile(this.db.currentTenantId!)).timezone;
  }
}

function policyFields(body: AttendancePolicyInputDto) {
  return {
    ...(body.workStart ? { workStart: body.workStart } : {}),
    ...(body.workEnd ? { workEnd: body.workEnd } : {}),
    ...(body.graceMinutes !== undefined ? { graceMinutes: body.graceMinutes } : {}),
    ...(body.halfDayMaxMinutes !== undefined ? { halfDayMaxMinutes: body.halfDayMaxMinutes } : {}),
    ...(body.weekendDays ? { weekendDays: [...new Set(body.weekendDays)].sort() } : {}),
    ...(body.locationRequired !== undefined ? { locationRequired: body.locationRequired } : {}),
    ...(body.officeLatitude !== undefined ? { officeLatitude: body.officeLatitude === null ? null : String(body.officeLatitude) } : {}),
    ...(body.officeLongitude !== undefined ? { officeLongitude: body.officeLongitude === null ? null : String(body.officeLongitude) } : {}),
    ...(body.officeRadiusM !== undefined ? { officeRadiusM: body.officeRadiusM } : {}),
  };
}

function checkPolicy(p: { workStart: string; workEnd: string; officeLatitude: string | null; officeLongitude: string | null; officeRadiusM: number | null }): void {
  const errors: { field: string; message: string }[] = [];
  if (p.workEnd.slice(0, 5) <= p.workStart.slice(0, 5)) errors.push({ field: 'workEnd', message: 'must be after workStart' });
  const office = [p.officeLatitude, p.officeLongitude, p.officeRadiusM].filter((v) => v !== null && v !== undefined).length;
  if (office !== 0 && office !== 3) errors.push({ field: 'officeRadiusM', message: 'set office latitude, longitude and radius together' });
  if (errors.length) throw Problems.validation(errors);
}

function rethrow(what: string) {
  return (err: unknown): never => {
    if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ProblemException(409, 'CONFLICT', 'Already exists', `A ${what} with this name already exists.`);
    if (isStillReferenced(err)) throw new ProblemException(409, 'CONFLICT', 'In use', `This ${what} is in use; switch it off instead.`);
    throw err;
  };
}

// ---------------------------------------------------------------- dates in the company's time zone
/** YYYY-MM-DD of an instant in a time zone. */
export function localDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Minutes after local midnight of an instant in a time zone. */
export function localMinutes(at: Date, tz: string): number {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at).split(':');
  return Number(h) * 60 + Number(m);
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/** Day of week of a date (0 = Sunday). */
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Every date from start to end inclusive. */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) out.push(d.toISOString().slice(0, 10));
  return out;
}

/** Distance in metres between two points (haversine). */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
