import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, lt, ne, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { APP_CONFIG, AppConfig } from '../../core/config/app-config';
import { DbService } from '../../core/database/db.service';
import { pgCode } from '../../core/errors/pg';
import { ProblemException, Problems } from '../../core/errors/problem';
import { decodeCursor, encodeCursor, Page } from '../../core/http/pagination';
import { IntegrationsService } from '../integrations/integrations.service';
import { LeadScope } from '../leads/lead-scope';
import { LeadsService } from '../leads/leads.service';
import { MessagingService } from '../messaging/messaging.service';
import { OrganizationDirectory } from '../organization/directory.service';
import { OrganizationService } from '../organization/organization.service';
import { TasksService } from '../tasks/tasks.service';
import { CalendarChange } from './adapters/calendar-sync';
import { MEETING_LINKS, MeetingLinkProvider } from './adapters/meeting-links';
import { MeetingChannel, MeetingRow, meetings } from './calendar.schema';
import { isTimeZone, MeetingCompleteDto, MeetingCreateDto, MeetingDto, MeetingListQuery, MeetingRescheduleDto } from './dto/calendar.dto';

const PG_EXCLUSION_VIOLATION = '23P01';
const CHANNEL_LABEL: Record<MeetingChannel, string> = { google_meet: 'Google Meet', teams: 'Microsoft Teams', in_person: 'In person', phone: 'Phone call' };
const MAX_MINUTES = 8 * 60;

export interface NewMeeting {
  leadId: string;
  organizerUserId: string;
  type: 'meeting' | 'viewing';
  channel: MeetingChannel;
  startsAt: Date;
  endsAt: Date;
  clientTimezone: string;
  location?: string | null;
  projectId?: string | null;
  unitId?: string | null;
  dealId?: string | null;
  bookingPageId?: string | null;
  createdBy: string | null;
  sendConfirmation: boolean;
}

/**
 * Meetings and viewings (SRS §3.8–3.12): Google Meet or Teams link from the agent's account, an entry in Tasks &
 * Calendar, a confirmation to the client, and no double booking (database exclusion constraint → 409 AGENT_BUSY).
 */
@Injectable()
export class MeetingsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly leads: LeadsService,
    private readonly scope: LeadScope,
    private readonly tasks: TasksService,
    private readonly messaging: MessagingService,
    private readonly integrations: IntegrationsService,
    private readonly directory: OrganizationDirectory,
    private readonly organization: OrganizationService,
    @Inject(MEETING_LINKS) private readonly links: MeetingLinkProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(p: Principal, q: MeetingListQuery): Promise<Page<MeetingDto>> {
    const offset = q.cursor ? Number(decodeCursor(q.cursor, 1)[0]) : 0;
    const rows = await this.db.current
      .select()
      .from(meetings)
      .where(
        and(
          await this.scope.visibleLeadIdIn(p, meetings.leadId),
          q.organizerUserId ? eq(meetings.organizerUserId, q.organizerUserId) : undefined,
          q.leadId ? eq(meetings.leadId, q.leadId) : undefined,
          q.status ? eq(meetings.status, q.status) : undefined,
          q.from ? gte(meetings.endsAt, new Date(q.from)) : undefined,
          q.to ? lt(meetings.startsAt, new Date(q.to)) : undefined,
        ),
      )
      .orderBy(asc(meetings.startsAt), asc(meetings.id))
      .limit(q.limit + 1)
      .offset(offset);
    const hasMore = rows.length > q.limit;
    return { data: rows.slice(0, q.limit).map(MeetingDto.from), page: { nextCursor: hasMore ? encodeCursor([offset + q.limit]) : null, hasMore } };
  }

  async get(p: Principal, id: string): Promise<MeetingRow> {
    const [row] = await this.db.current
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, id), await this.scope.visibleLeadIdIn(p, meetings.leadId)))
      .limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }

  async create(p: Principal, body: MeetingCreateDto): Promise<MeetingDto> {
    await this.leads.editable(p, body.leadId);
    const row = await this.schedule({
      leadId: body.leadId,
      organizerUserId: body.organizerUserId,
      type: body.type,
      channel: body.channel,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      clientTimezone: body.clientTimezone ?? (await this.tenantTimeZone()),
      location: body.location ?? null,
      projectId: body.projectId ?? null,
      unitId: body.unitId ?? null,
      dealId: body.dealId ?? null,
      createdBy: p.userId,
      sendConfirmation: body.sendConfirmation ?? true,
    });
    await this.leads.recordAction(body.leadId, p.userId);
    return MeetingDto.from(row);
  }

  /** Shared by agents (POST /meetings) and clients (public booking page). */
  async schedule(m: NewMeeting): Promise<MeetingRow> {
    checkTimes(m.startsAt, m.endsAt);
    if (!isTimeZone(m.clientTimezone)) throw Problems.validation([{ field: 'clientTimezone', message: 'an IANA time zone such as Asia/Dubai' }]);
    const organizer = await this.directory.user(m.organizerUserId);
    if (!organizer || organizer.status !== 'active') throw Problems.validation([{ field: 'organizerUserId', message: 'not an active user' }]);
    await this.assertFree(m.organizerUserId, m.startsAt, m.endsAt);
    const lead = (await this.leads.findRow(m.leadId))!;
    const title = `${m.type === 'viewing' ? 'Viewing' : 'Meeting'} · ${lead.fullName}`;

    let joinUrl: string | null = null;
    let externalMeetingId: string | null = null;
    if (m.channel === 'google_meet' || m.channel === 'teams') {
      const account = await this.integrations.connectedUserAccount(m.channel === 'google_meet' ? 'google_workspace' : 'microsoft_365', m.organizerUserId);
      if (!account && this.config.CALENDAR_MODE === 'live') {
        throw new ProblemException(422, 'CALENDAR_NOT_CONNECTED', 'Calendar not connected', `${organizer.fullName} needs to connect a ${m.channel === 'google_meet' ? 'Google' : 'Microsoft 365'} account to create ${CHANNEL_LABEL[m.channel]} links.`);
      }
      try {
        const link = await this.links.create({
          channel: m.channel,
          title,
          startsAt: m.startsAt,
          endsAt: m.endsAt,
          ...(account ? { account: { settings: account.settings, credentials: await this.integrations.credentials(account) } } : {}),
        });
        joinUrl = link.joinUrl;
        externalMeetingId = link.externalMeetingId;
      } catch (err) {
        throw new ProblemException(422, 'MEETING_LINK_FAILED', 'Meeting link not created', (err as Error).message);
      }
    }

    const row = await this.insertOrBusy({
      tenantId: this.db.currentTenantId!,
      leadId: m.leadId,
      organizerUserId: m.organizerUserId,
      type: m.type,
      channel: m.channel,
      bookedVia: m.bookingPageId ? 'booking_page' : 'agent',
      bookingPageId: m.bookingPageId ?? null,
      externalMeetingId,
      joinUrl,
      location: m.location ?? null,
      projectId: m.projectId ?? null,
      unitId: m.unitId ?? null,
      dealId: m.dealId ?? null,
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      clientTimezone: m.clientTimezone,
      createdBy: m.createdBy,
    });
    await this.tasks.createForMeeting({
      leadId: m.leadId,
      meetingId: row.id,
      assignedUserId: m.organizerUserId,
      type: m.type,
      title: `${title} (${CHANNEL_LABEL[m.channel]})`,
      dueAt: m.startsAt,
      durationMinutes: minutes(m.startsAt, m.endsAt),
      createdBy: m.createdBy,
    });
    await this.leads.addActivity(m.leadId, {
      type: m.type,
      summary: `${m.type === 'viewing' ? 'Viewing' : 'Meeting'} ${m.bookingPageId ? 'booked via booking page' : 'scheduled'}: ${await this.when(m.startsAt)} · ${CHANNEL_LABEL[m.channel]}`,
      body: [joinUrl ? `Link: ${joinUrl}` : null, m.location ? `Location: ${m.location}` : null].filter(Boolean).join('\n') || null,
      actorUserId: m.createdBy,
      links: { meetingId: row.id },
    });
    await this.audit.record('create', 'meetings', row.id, { startsAt: [null, row.startsAt.toISOString()], channel: [null, row.channel] }, m.createdBy ?? undefined);
    if (m.sendConfirmation) await this.confirm(row, 'confirmed');
    return row;
  }

  async reschedule(p: Principal, id: string, body: MeetingRescheduleDto): Promise<MeetingDto> {
    const before = await this.get(p, id);
    await this.leads.editable(p, before.leadId);
    if (before.status !== 'scheduled') throw new ProblemException(409, 'CONFLICT', 'Meeting not scheduled', `The meeting is ${before.status}.`);
    const startsAt = body.startsAt ? new Date(body.startsAt) : before.startsAt;
    const endsAt = body.endsAt ? new Date(body.endsAt) : new Date(startsAt.getTime() + (before.endsAt.getTime() - before.startsAt.getTime()));
    checkTimes(startsAt, endsAt);
    const moved = startsAt.getTime() !== before.startsAt.getTime() || endsAt.getTime() !== before.endsAt.getTime();
    if (moved) await this.assertFree(before.organizerUserId, startsAt, endsAt, id);
    const [row] = await this.updateOrBusy(id, {
      startsAt,
      endsAt,
      location: body.location ?? before.location,
      ...(moved ? { rescheduleCount: before.rescheduleCount + 1 } : {}),
      updatedAt: new Date(),
    });
    if (moved) {
      await this.tasks.syncMeetingTask(id, { dueAt: startsAt, durationMinutes: minutes(startsAt, endsAt) });
      await this.leads.addActivity(before.leadId, { type: before.type, summary: `${before.type === 'viewing' ? 'Viewing' : 'Meeting'} moved to ${await this.when(startsAt)}`, actorUserId: p.userId, links: { meetingId: id } });
      await this.confirm(row!, 'moved');
    }
    await this.audit.record('update', 'meetings', id, { startsAt: [before.startsAt.toISOString(), startsAt.toISOString()], location: [before.location, row!.location] });
    await this.leads.recordAction(before.leadId, p.userId);
    return MeetingDto.from(row!);
  }

  async cancel(p: Principal, id: string, reason: string): Promise<MeetingDto> {
    const before = await this.get(p, id);
    await this.leads.editable(p, before.leadId);
    if (before.status !== 'scheduled') throw new ProblemException(409, 'CONFLICT', 'Meeting not scheduled', `The meeting is ${before.status}.`);
    const [row] = await this.db.current
      .update(meetings)
      .set({ status: 'cancelled', cancelReason: reason.trim(), updatedAt: new Date() })
      .where(eq(meetings.id, id))
      .returning();
    await this.tasks.syncMeetingTask(id, { status: 'cancelled' });
    await this.leads.addActivity(before.leadId, { type: before.type, summary: `${before.type === 'viewing' ? 'Viewing' : 'Meeting'} cancelled`, body: reason.trim(), actorUserId: p.userId, links: { meetingId: id } });
    await this.audit.record('update', 'meetings', id, { status: ['scheduled', 'cancelled'] });
    await this.confirm(row!, 'cancelled');
    return MeetingDto.from(row!);
  }

  /** After the meeting: held or no-show, a note, and optionally the next action (SRS §3.2). */
  async complete(p: Principal, id: string, body: MeetingCompleteDto): Promise<MeetingDto> {
    const before = await this.get(p, id);
    await this.leads.editable(p, before.leadId);
    if (before.status !== 'scheduled') throw new ProblemException(409, 'CONFLICT', 'Meeting not scheduled', `The meeting is ${before.status}.`);
    const [row] = await this.db.current.update(meetings).set({ status: body.status, updatedAt: new Date() }).where(eq(meetings.id, id)).returning();
    await this.tasks.syncMeetingTask(id, { status: 'completed', userId: p.userId });
    const label = before.type === 'viewing' ? 'Viewing' : 'Meeting';
    await this.leads.addActivity(before.leadId, { type: before.type, summary: body.status === 'no_show' ? `${label}: client did not come` : `${label} held`, body: body.note ?? null, actorUserId: p.userId, links: { meetingId: id } });
    if (body.nextAction) {
      await this.tasks.create(p, {
        leadId: before.leadId,
        type: body.nextAction.type,
        title: body.nextAction.title ?? `${body.nextAction.type === 'follow_up' ? 'Follow-up' : body.nextAction.type[0]!.toUpperCase() + body.nextAction.type.slice(1)} after ${label.toLowerCase()}`,
        dueAt: body.nextAction.dueAt,
        reminderMinutes: body.nextAction.reminderMinutes ?? null,
      });
    }
    await this.audit.record('update', 'meetings', id, { status: ['scheduled', body.status] });
    await this.leads.recordAction(before.leadId, p.userId);
    return MeetingDto.from(row!);
  }

  /**
   * A change made in the agent's Google or Microsoft calendar (SRS §3.13): a moved event moves the meeting, a
   * deleted one cancels it, and the client is told. A move onto another meeting is not applied (no double booking).
   */
  async applyExternalChange(change: CalendarChange, calendarName: string): Promise<void> {
    const [m] = await this.db.current
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.status, 'scheduled'),
          change.joinUrl ? sql`(${meetings.externalMeetingId} = ${change.externalMeetingId} OR ${meetings.joinUrl} = ${change.joinUrl})` : eq(meetings.externalMeetingId, change.externalMeetingId),
        ),
      )
      .limit(1);
    if (!m) return;
    const label = m.type === 'viewing' ? 'Viewing' : 'Meeting';
    if (change.status === 'cancelled') {
      const [row] = await this.db.current
        .update(meetings)
        .set({ status: 'cancelled', cancelReason: `Cancelled in ${calendarName}`, updatedAt: new Date() })
        .where(eq(meetings.id, m.id))
        .returning();
      await this.tasks.syncMeetingTask(m.id, { status: 'cancelled' });
      await this.leads.addActivity(m.leadId, { type: m.type, summary: `${label} cancelled in ${calendarName}`, actorUserId: null, links: { meetingId: m.id } });
      await this.audit.record('update', 'meetings', m.id, { status: ['scheduled', 'cancelled'] });
      await this.confirm(row!, 'cancelled');
      return;
    }
    if (!change.startsAt || !change.endsAt || change.endsAt <= change.startsAt) return;
    if (change.startsAt.getTime() === m.startsAt.getTime() && change.endsAt.getTime() === m.endsAt.getTime()) return;
    // In a savepoint: a clash (exclusion constraint) must not abort the rest of the sync.
    const attempt = await this.db.savepoint(() => this.updateOrBusy(m.id, { startsAt: change.startsAt, endsAt: change.endsAt, rescheduleCount: m.rescheduleCount + 1, updatedAt: new Date() }));
    if (!attempt.ok && !(attempt.error instanceof ProblemException && attempt.error.code === 'AGENT_BUSY')) throw attempt.error;
    const moved = attempt.ok ? attempt.value : undefined;
    if (!moved) {
      await this.leads.addActivity(m.leadId, { type: m.type, summary: `${label} not moved: ${calendarName} change clashes with another meeting`, actorUserId: null, links: { meetingId: m.id } });
      return;
    }
    await this.tasks.syncMeetingTask(m.id, { dueAt: change.startsAt, durationMinutes: minutes(change.startsAt, change.endsAt) });
    await this.leads.addActivity(m.leadId, { type: m.type, summary: `${label} moved to ${await this.when(change.startsAt)} in ${calendarName}`, actorUserId: null, links: { meetingId: m.id } });
    await this.audit.record('update', 'meetings', m.id, { startsAt: [m.startsAt.toISOString(), change.startsAt.toISOString()] });
    await this.confirm(moved[0]!, 'moved');
  }

  /** Scheduled meetings of an agent in a period (busy times for free slots). */
  async busy(userId: string, from: Date, to: Date): Promise<{ startsAt: Date; endsAt: Date }[]> {
    return this.db.current
      .select({ startsAt: meetings.startsAt, endsAt: meetings.endsAt })
      .from(meetings)
      .where(and(eq(meetings.organizerUserId, userId), eq(meetings.status, 'scheduled'), lt(meetings.startsAt, to), gte(meetings.endsAt, from)));
  }

  // ---------------------------------------------------------------- helpers
  private async assertFree(userId: string, startsAt: Date, endsAt: Date, exceptId?: string): Promise<void> {
    const [clash] = await this.db.current
      .select({ id: meetings.id })
      .from(meetings)
      .where(
        and(
          eq(meetings.organizerUserId, userId),
          eq(meetings.status, 'scheduled'),
          lt(meetings.startsAt, endsAt),
          sql`${meetings.endsAt} > ${startsAt}`,
          exceptId ? ne(meetings.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    if (clash) throw agentBusy();
  }

  /** The database also blocks overlaps (two bookings at the same moment): answered as AGENT_BUSY. */
  private async insertOrBusy(values: typeof meetings.$inferInsert): Promise<MeetingRow> {
    try {
      const [row] = await this.db.current.insert(meetings).values(values).returning();
      return row!;
    } catch (err) {
      if (pgCode(err) === PG_EXCLUSION_VIOLATION) throw agentBusy();
      throw err;
    }
  }

  private async updateOrBusy(id: string, patch: Partial<typeof meetings.$inferInsert>): Promise<MeetingRow[]> {
    try {
      return await this.db.current.update(meetings).set(patch).where(eq(meetings.id, id)).returning();
    } catch (err) {
      if (pgCode(err) === PG_EXCLUSION_VIOLATION) throw agentBusy();
      throw err;
    }
  }

  /** Confirmation, change or cancellation to the client by email (SRS §3.10), in the client's time zone. */
  private async confirm(m: MeetingRow, what: 'confirmed' | 'moved' | 'cancelled'): Promise<void> {
    const organizer = await this.directory.user(m.organizerUserId);
    const when = new Intl.DateTimeFormat('en-GB', { timeZone: m.clientTimezone, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(m.startsAt);
    const kind = m.type === 'viewing' ? 'viewing' : 'meeting';
    const subject = what === 'cancelled' ? `Your ${kind} is cancelled` : what === 'moved' ? `Your ${kind} has a new time` : `Your ${kind} is confirmed`;
    const body = [
      what === 'cancelled' ? `Your ${kind} on ${when} has been cancelled.` : `${what === 'moved' ? 'New time' : 'Confirmed'}: ${when} (${m.clientTimezone}).`,
      what !== 'cancelled' && m.joinUrl ? `Join: ${m.joinUrl}` : null,
      what !== 'cancelled' && m.location ? `Location: ${m.location}` : null,
      organizer ? `With ${organizer.fullName}.` : null,
    ]
      .filter(Boolean)
      .join('\n');
    await this.messaging.sendSystem({ leadId: m.leadId, channel: 'email', subject, body, summary: `Email: ${subject.toLowerCase()}` });
  }

  /** The company's time zone (Organization profile), used for times on the timeline. */
  async tenantTimeZone(): Promise<string> {
    return (await this.organization.getProfile(this.db.currentTenantId!)).timezone;
  }

  private async when(at: Date): Promise<string> {
    return new Intl.DateTimeFormat('en-GB', { timeZone: await this.tenantTimeZone(), weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(at);
  }
}

function agentBusy(): ProblemException {
  return new ProblemException(409, 'AGENT_BUSY', 'Agent already booked', 'The agent already has a meeting at this time. Pick another time.');
}

function checkTimes(startsAt: Date, endsAt: Date): void {
  if (!(endsAt > startsAt)) throw Problems.validation([{ field: 'endsAt', message: 'must be after startsAt' }]);
  if (minutes(startsAt, endsAt) > MAX_MINUTES) throw Problems.validation([{ field: 'endsAt', message: 'a meeting is at most 8 hours' }]);
}

function minutes(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}
