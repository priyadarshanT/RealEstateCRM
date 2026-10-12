import { Module } from '@nestjs/common';
import { requestGuards } from './core/auth/auth.module';
import { CoreModule } from './core/core.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { AssignmentModule } from './modules/assignment/assignment.module';
import { LeadsModule } from './modules/leads/leads.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ScoringModule } from './modules/scoring/scoring.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { SettingsModule } from './modules/settings/settings.module';

// Composition root: shared core plus one import per business module.
@Module({
  imports: [CoreModule, OrganizationModule, SettingsModule, LeadsModule, AssignmentModule, NotificationsModule, TasksModule, ScoringModule],
  providers: [...requestGuards],
})
export class AppModule {}
