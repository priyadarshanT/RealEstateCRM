import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { APP_CONFIG, AppConfig } from '../../core/config/app-config';
import { DbService } from '../../core/database/db.service';
import { WorkerDbService } from '../../core/database/worker-db.service';
import { pgCode, PG_UNIQUE_VIOLATION } from '../../core/errors/pg';
import { ProblemException, Problems } from '../../core/errors/problem';
import { BOT_CHECK, BotCheck } from '../billing/adapters/services';
import { LeadIntakeService } from '../leads/lead-intake.service';
import { MessagingService } from '../messaging/messaging.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganizationDirectory } from '../organization/directory.service';
import { OrganizationService } from '../organization/organization.service';
import { LeadConfigService } from '../settings/lead-config.service';
import { BookingPageRow, bookingPages } from './calendar.schema';
import {
  AvailabilityDto,
  AvailabilityQuery,
  BookingPageDto,
  BookingPageInputDto,
  isTimeZone,
  PublicBookingConfirmationDto,
  PublicBookingPageDto,
  PublicBookingQuery,
  PublicBookingRequestDto,
} from './dto/calendar.dto';
import { MeetingsService } from './meetings.service';
import { checkWeeklyHours, DEFAULT_WEEKLY_HOURS, freeSlots, isFreeSlot } from './slots';

const DAY = 86_400_000;
const PUBLIC_DAYS = 14;
const SOURCE_NAME = 'Booking page';

/**
 * Each agent's booking page (SRS §3.9–3.12, replaces Calendly): the agent sets hours and meeting type; clients pick
 * a free slot without logging in. The booking finds the client's existing lead (re-enquiry) or creates one owned by
 * the agent, creates the meeting with its link, and confirms it.
 */
@Injectable()
export class BookingService {
  constructor(
    private readonly db: DbService,
    private readonly workerDb: WorkerDbService,
    private readonly audit: AuditService,
    private readonly meetings: MeetingsService,
    private readonly intake: LeadIntakeService,
    private readonly leadConfig: LeadConfigService,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService,
    private readonly directory: OrganizationDirectory,
    private readonly organization: OrganizationService,
    @Inject(BOT_CHECK) private readonly bot: BotCheck,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ---------------------------------------------------------------- the agent's own page
  async getMine(p: Principal): Promise<BookingPageDto> {
    const [row] = await this.db.current.select().from(bookingPages).where(eq(bookingPages.userId, p.userId)).limit(1);
    if (!row) throw Problems.notFound('You have no booking page yet. Save one to get your link.');
    return BookingPageDto.from(row, this.config.WEB_APP_URL);
  }

  async saveMine(p: Principal, body: BookingPageInputDto): Promise<BookingPageDto> {
    const { weeklyHours, errors } = checkWeeklyHours(body.weeklyHours);
    if (errors.length) throw Problems.validation(errors);
    const values = {
      slug: body.slug,
      title: body.title.trim(),
      meetingChannel: body.meetingChannel ?? 'google_meet',
      durationMinutes: body.durationMinutes,
      bufferMinutes: body.bufferMinutes ?? 10,
      minNoticeHours: body.minNoticeHours ?? 2,
      weeklyHours,
      isActive: body.isActive,
      updatedAt: new Date(),
    };
    try {
      const [row] = await this.db.current
        .insert(bookingPages)
        .values({ tenantId: p.tenantId, userId: p.userId, ...values })
        .onConflictDoUpdate({ target: bookingPages.userId, set: values })
        .returning();
      await this.audit.record('setting_change', 'booking_pages', row!.id, { slug: [null, row!.slug], isActive: [null, row!.isActive] });
      return BookingPageDto.from(row!, this.config.WEB_APP_URL);
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ProblemException(409, 'SLUG_TAKEN', 'Link name taken', `"${body.slug}" is already used. Choose another link name.`);
      throw err;
    }
  }

  /** Free slots of an agent for scheduling (their booking-page hours, or Monday–Friday 9–18). */
  async availability(q: AvailabilityQuery): Promise<AvailabilityDto> {
    const user = await this.directory.user(q.userId);
    if (!user || user.status !== 'active') throw Problems.validation([{ field: 'userId', message: 'not an active user' }]);
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (!(to > from) || to.getTime() - from.getTime() > 62 * DAY) throw Problems.validation([{ field: 'to', message: 'after from, at most 62 days later' }]);
    const [page] = await this.db.current.select().from(bookingPages).where(eq(bookingPages.userId, q.userId)).limit(1);
    const slots = freeSlots({
      from,
      to,
      durationMinutes: q.durationMinutes ?? page?.durationMinutes ?? 30,
      bufferMinutes: page?.bufferMinutes ?? 0,
      minNoticeHours: 0,
      weeklyHours: page && Object.keys(page.weeklyHours).length ? page.weeklyHours : DEFAULT_WEEKLY_HOURS,
      timeZone: await this.meetings.tenantTimeZone(),
      busy: await this.meetings.busy(q.userId, from, to),
    });
    return { slots: slots.map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })) };
  }

  // ---------------------------------------------------------------- public page (no login)
  async publicPage(slug: string, q: PublicBookingQuery): Promise<PublicBookingPageDto> {
    const found = await this.findPage(slug);
    return this.db.withTenant(found.tenantId, async () => {
      const page = await this.page(found.id);
      const agent = await this.directory.user(page.userId);
      const tenant = await this.organization.getProfile(found.tenantId);
      const from = q.from ? new Date(q.from) : new Date();
      const to = q.to ? new Date(q.to) : new Date(from.getTime() + PUBLIC_DAYS * DAY);
      if (!(to > from) || to.getTime() - from.getTime() > 62 * DAY) throw Problems.validation([{ field: 'to', message: 'after from, at most 62 days later' }]);
      const slots = await this.slots(page, from, to, tenant.timezone);
      return {
        title: page.title,
        agentName: agent?.fullName ?? '',
        companyName: tenant.name,
        durationMinutes: page.durationMinutes,
        meetingChannel: page.meetingChannel,
        slots: slots.map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
      };
    });
  }

  async book(slug: string, body: PublicBookingRequestDto, turnstileToken: string, ip?: string): Promise<PublicBookingConfirmationDto> {
    if (!(await this.bot.verify(turnstileToken, ip))) throw new ProblemException(422, 'BOT_CHECK_FAILED', 'Please try again', 'The security check failed. Reload the page and try again.');
    if (!isTimeZone(body.timezone)) throw Problems.validation([{ field: 'timezone', message: 'an IANA time zone such as Europe/London' }]);
    const found = await this.findPage(slug);
    return this.db.withTenant(found.tenantId, async () => {
      const page = await this.page(found.id);
      const tenant = await this.organization.getProfile(found.tenantId);
      const startsAt = new Date(body.startsAt);
      const endsAt = new Date(startsAt.getTime() + page.durationMinutes * 60_000);
      const free = isFreeSlot(
        {
          durationMinutes: page.durationMinutes,
          bufferMinutes: page.bufferMinutes,
          minNoticeHours: page.minNoticeHours,
          weeklyHours: this.hours(page),
          timeZone: tenant.timezone,
          busy: await this.meetings.busy(page.userId, new Date(startsAt.getTime() - DAY), new Date(endsAt.getTime() + DAY)),
        },
        startsAt,
      );
      if (!free) throw slotTaken();

      const intake = await this.intake.receive({
        sourceId: await this.sourceId(),
        fullName: body.fullName.trim(),
        phone: body.phone,
        email: body.email || null,
        formName: SOURCE_NAME,
        formAnswers: { slot: startsAt.toISOString(), timezone: body.timezone, ...(body.message ? { message: body.message } : {}) },
        note: body.message?.trim() || null,
        ownerUserId: page.userId,
      });
      if (intake.status === 'rejected') throw Problems.validation(intake.errors.map((message) => ({ field: 'phone', message })));
      const leadId = intake.leadId!;
      if (body.consentWhatsApp) await this.messaging.recordConsent(leadId, 'whatsapp', 'opted_in', 'form', 'Booking page', null);

      const meeting = await this.meetings
        .schedule({
          leadId,
          organizerUserId: page.userId,
          type: 'meeting',
          channel: page.meetingChannel,
          startsAt,
          endsAt,
          clientTimezone: body.timezone,
          bookingPageId: page.id,
          createdBy: null,
          sendConfirmation: true,
        })
        .catch((err: unknown) => {
          if (err instanceof ProblemException && err.code === 'AGENT_BUSY') throw slotTaken();
          throw err;
        });
      await this.notifications.notify({ userId: page.userId, type: 'meeting_booked', title: `New booking: ${body.fullName.trim()}`, body: `Booked on your booking page for ${startsAt.toISOString()}`, leadId });
      return { startsAt: meeting.startsAt.toISOString(), endsAt: meeting.endsAt.toISOString(), joinUrl: meeting.joinUrl, timezone: body.timezone };
    });
  }

  // ---------------------------------------------------------------- helpers
  /** The public link reaches across companies: find the page's company first (worker connection), then work inside it. */
  private async findPage(slug: string): Promise<{ id: string; tenantId: string }> {
    const [row] = await this.workerDb.db.select({ id: bookingPages.id, tenantId: bookingPages.tenantId, isActive: bookingPages.isActive }).from(bookingPages).where(eq(bookingPages.slug, slug)).limit(1);
    if (!row || !row.isActive) throw Problems.notFound('This booking page does not exist or is switched off.');
    return row;
  }

  private async page(id: string): Promise<BookingPageRow> {
    const [row] = await this.db.current.select().from(bookingPages).where(eq(bookingPages.id, id)).limit(1);
    return row!;
  }

  private hours(page: BookingPageRow) {
    return Object.keys(page.weeklyHours).length ? page.weeklyHours : DEFAULT_WEEKLY_HOURS;
  }

  private async slots(page: BookingPageRow, from: Date, to: Date, timeZone: string) {
    return freeSlots({
      from,
      to,
      durationMinutes: page.durationMinutes,
      bufferMinutes: page.bufferMinutes,
      minNoticeHours: page.minNoticeHours,
      weeklyHours: this.hours(page),
      timeZone,
      busy: await this.meetings.busy(page.userId, from, to),
    });
  }

  /** Leads booked by clients come from the "Booking page" source (created on first use). */
  private async sourceId(): Promise<string> {
    const sources = await this.leadConfig.listSources(200);
    const found = sources.data.find((s) => s.name === SOURCE_NAME);
    if (found) return found.id;
    return (await this.leadConfig.createSource({ type: 'website', name: SOURCE_NAME, qualityScore: 70 } as never)).id;
  }
}

function slotTaken(): ProblemException {
  return new ProblemException(409, 'SLOT_TAKEN', 'Time no longer free', 'Someone just booked this time. Please pick another one.');
}
