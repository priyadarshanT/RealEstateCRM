import { boolean, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Meetings, viewings and booking pages (db/schema.sql, TASKS AND MEETINGS).

export type MeetingChannel = 'google_meet' | 'teams' | 'in_person' | 'phone' | 'online_link';
/** Appointment types of the Lead page: call, Zoom / online meeting, event, property viewing. */
export type MeetingType = 'meeting' | 'viewing' | 'call' | 'event';
export type MeetingStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';
/** Bookable hours per weekday in the tenant time zone, e.g. { sun: [["09:00","17:00"]] }. */
export type WeeklyHours = Partial<Record<'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat', [string, string][]>>;

export const bookingPages = pgTable('booking_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  meetingChannel: text('meeting_channel').$type<MeetingChannel>().notNull().default('google_meet'),
  durationMinutes: smallint('duration_minutes').notNull().default(30),
  bufferMinutes: smallint('buffer_minutes').notNull().default(10),
  minNoticeHours: smallint('min_notice_hours').notNull().default(2),
  weeklyHours: jsonb('weekly_hours').$type<WeeklyHours>().notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const meetings = pgTable('meetings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  organizerUserId: uuid('organizer_user_id').notNull(),
  type: text('type').$type<MeetingType>().notNull(),
  channel: text('channel').$type<MeetingChannel>().notNull(),
  bookedVia: text('booked_via').$type<'agent' | 'booking_page'>().notNull().default('agent'),
  bookingPageId: uuid('booking_page_id'),
  externalMeetingId: text('external_meeting_id'),
  joinUrl: text('join_url'),
  location: text('location'),
  projectId: uuid('project_id'),
  unitId: uuid('unit_id'),
  dealId: uuid('deal_id'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  clientTimezone: text('client_timezone').notNull().default('Asia/Dubai'),
  status: text('status').$type<MeetingStatus>().notNull().default('scheduled'),
  cancelReason: text('cancel_reason'),
  notes: text('notes'),
  rescheduleCount: smallint('reschedule_count').notNull().default(0),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type BookingPageRow = typeof bookingPages.$inferSelect;
export type MeetingRow = typeof meetings.$inferSelect;
