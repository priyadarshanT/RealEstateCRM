import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationModule } from '../organization/organization.module';
import { TaskJobs } from './task-jobs';
import { LeadCallsController, TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/** Calls, tasks, reminders, overdue alerts and the 10-minute response timer (SRS §3.1–3.7). */
@Module({
  imports: [LeadsModule, OrganizationModule, NotificationsModule],
  controllers: [TasksController, LeadCallsController],
  providers: [TasksService, TaskJobs],
  exports: [TasksService, TaskJobs],
})
export class TasksModule {}
