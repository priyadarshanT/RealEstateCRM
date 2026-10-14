import { boolean, date, integer, jsonb, numeric, pgTable, smallint, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';

// Attendance (db/schema.sql, ATTENDANCE): policies, holidays, leave types and requests, daily records, corrections.

export const DAY_STATUSES = ['present', 'late', 'absent', 'leave', 'half_day', 'wfh'] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

export const attendancePolicies = pgTable('attendance_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  workStart: time('work_start').notNull(),
  workEnd: time('work_end').notNull(),
  graceMinutes: smallint('grace_minutes').notNull().default(10),
  halfDayMaxMinutes: smallint('half_day_max_minutes').notNull().default(300),
  weekendDays: smallint('weekend_days').array().notNull(),
  locationRequired: boolean('location_required').notNull().default(false),
  officeLatitude: numeric('office_latitude', { precision: 9, scale: 6 }),
  officeLongitude: numeric('office_longitude', { precision: 9, scale: 6 }),
  officeRadiusM: integer('office_radius_m'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const holidays = pgTable('holidays', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  holidayDate: date('holiday_date').notNull(),
  name: text('name').notNull(),
});

export const leaveTypes = pgTable('leave_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  annualDays: numeric('annual_days', { precision: 5, scale: 1 }),
  isPaid: boolean('is_paid').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
});

export const leaveRequests = pgTable('leave_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  leaveTypeId: uuid('leave_type_id').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  isHalfDay: boolean('is_half_day').notNull().default(false),
  reason: text('reason'),
  status: text('status').$type<'pending' | 'approved' | 'rejected' | 'cancelled'>().notNull().default('pending'),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNote: text('review_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const attendanceRecords = pgTable('attendance_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  workDate: date('work_date').notNull(),
  status: text('status').$type<DayStatus>().notNull(),
  checkInAt: timestamp('check_in_at', { withTimezone: true }),
  checkInPhotoFileId: uuid('check_in_photo_file_id'),
  checkInLatitude: numeric('check_in_latitude', { precision: 9, scale: 6 }),
  checkInLongitude: numeric('check_in_longitude', { precision: 9, scale: 6 }),
  checkOutAt: timestamp('check_out_at', { withTimezone: true }),
  checkOutPhotoFileId: uuid('check_out_photo_file_id'),
  checkOutLatitude: numeric('check_out_latitude', { precision: 9, scale: 6 }),
  checkOutLongitude: numeric('check_out_longitude', { precision: 9, scale: 6 }),
  leaveRequestId: uuid('leave_request_id'),
  source: text('source').$type<'app' | 'system' | 'correction'>().notNull().default('app'),
  isCorrected: boolean('is_corrected').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const attendanceCorrections = pgTable('attendance_corrections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  recordId: uuid('record_id').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  originalValues: jsonb('original_values').$type<Record<string, unknown>>().notNull(),
  requestedStatus: text('requested_status').$type<DayStatus>().notNull(),
  requestedCheckInAt: timestamp('requested_check_in_at', { withTimezone: true }),
  requestedCheckOutAt: timestamp('requested_check_out_at', { withTimezone: true }),
  reason: text('reason').notNull(),
  status: text('status').$type<'pending' | 'approved' | 'rejected'>().notNull().default('pending'),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNote: text('review_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PolicyRow = typeof attendancePolicies.$inferSelect;
export type HolidayRow = typeof holidays.$inferSelect;
export type LeaveTypeRow = typeof leaveTypes.$inferSelect;
export type LeaveRequestRow = typeof leaveRequests.$inferSelect;
export type RecordRow = typeof attendanceRecords.$inferSelect;
export type CorrectionRow = typeof attendanceCorrections.$inferSelect;
