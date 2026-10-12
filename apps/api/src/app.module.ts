import { Module } from '@nestjs/common';
import { requestGuards } from './core/auth/auth.module';
import { CoreModule } from './core/core.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { AssignmentModule } from './modules/assignment/assignment.module';
import { DashboardModule } from './modules/dashboard/dashboard.service';
import { EventsModule } from './modules/events/events.service';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { LeadsModule } from './modules/leads/leads.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ScoringModule } from './modules/scoring/scoring.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { SettingsModule } from './modules/settings/settings.module';

// Composition root: shared core plus one import per business module.
@Module({
  imports: [CoreModule, OrganizationModule, SettingsModule, LeadsModule, AssignmentModule, NotificationsModule, TasksModule, ScoringModule, MarketingModule, EventsModule, IntegrationsModule, DashboardModule, ReportsModule],
  providers: [...requestGuards],
})
export class AppModule {}
