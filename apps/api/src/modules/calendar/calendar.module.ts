import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../core/config/app-config';
import { BillingModule } from '../billing/billing.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LeadsModule } from '../leads/leads.module';
import { MessagingModule } from '../messaging/messaging.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationModule } from '../organization/organization.module';
import { SettingsModule } from '../settings/settings.module';
import { TasksModule } from '../tasks/tasks.module';
import { CALENDAR_SYNC, LiveCalendarSync, SimulatedCalendarSync } from './adapters/calendar-sync';
import { LiveMeetingLinks, MEETING_LINKS, SimulatedMeetingLinks } from './adapters/meeting-links';
import { BookingService } from './booking.service';
import { CalendarSyncService, CalendarWebhookController } from './calendar-sync.service';
import { MeetingsController, PublicBookingController } from './calendar.controller';
import { MeetingsService } from './meetings.service';

/** Meetings and viewings, free slots, each agent's public booking page and calendar sync (SRS §3.8–3.13). */
@Module({
  imports: [LeadsModule, TasksModule, MessagingModule, IntegrationsModule, OrganizationModule, NotificationsModule, SettingsModule, BillingModule],
  controllers: [MeetingsController, PublicBookingController, CalendarWebhookController],
  providers: [
    MeetingsService,
    BookingService,
    CalendarSyncService,
    { provide: MEETING_LINKS, inject: [APP_CONFIG], useFactory: (c: AppConfig) => (c.CALENDAR_MODE === 'live' ? new LiveMeetingLinks() : new SimulatedMeetingLinks()) },
    { provide: CALENDAR_SYNC, inject: [APP_CONFIG], useFactory: (c: AppConfig) => (c.CALENDAR_MODE === 'live' ? new LiveCalendarSync() : new SimulatedCalendarSync()) },
  ],
  exports: [MeetingsService],
})
export class CalendarModule {}
