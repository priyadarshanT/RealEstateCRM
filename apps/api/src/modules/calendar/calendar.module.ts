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
import { LiveMeetingLinks, MEETING_LINKS, SimulatedMeetingLinks } from './adapters/meeting-links';
import { BookingService } from './booking.service';
import { MeetingsController, PublicBookingController } from './calendar.controller';
import { MeetingsService } from './meetings.service';

/** Meetings and viewings, free slots and each agent's public booking page (SRS §3.8–3.12). */
@Module({
  imports: [LeadsModule, TasksModule, MessagingModule, IntegrationsModule, OrganizationModule, NotificationsModule, SettingsModule, BillingModule],
  controllers: [MeetingsController, PublicBookingController],
  providers: [
    MeetingsService,
    BookingService,
    { provide: MEETING_LINKS, inject: [APP_CONFIG], useFactory: (c: AppConfig) => (c.CALENDAR_MODE === 'live' ? new LiveMeetingLinks() : new SimulatedMeetingLinks()) },
  ],
  exports: [MeetingsService],
})
export class CalendarModule {}
