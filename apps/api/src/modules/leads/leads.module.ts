import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { SecondaryOwnerNotifier } from './secondary-owner-notifier';
import { OrganizationModule } from '../organization/organization.module';
import { USER_LEADS_PORT } from '../organization/organization.ports';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { LeadImportController } from './import/lead-import.controller';
import { LeadImportService } from './import/lead-import.service';
import { LeadActionsService } from './lead-actions.service';
import { LeadIntakeService } from './lead-intake.service';
import { LeadReportingService } from './lead-reporting.service';
import { LeadLookupController, SavedFiltersController } from './lead-misc.controller';
import { LeadScope } from './lead-scope';
import { LeadsController } from './leads.controller';
import { LeadsRepository } from './leads.repository';
import { LeadsService } from './leads.service';
import { SavedFiltersService } from './saved-filters.service';
import { UserLeadsAdapter } from './user-leads.adapter';

/** Leads: list and tabs, lead page, timeline, re-enquiries, sharing, saved filters, search (SRS §1–2). */
@Module({
  imports: [OrganizationModule, SettingsModule, NotificationsModule, ProjectsModule],
  controllers: [LeadImportController, LeadsController, SavedFiltersController, LeadLookupController],
  providers: [SecondaryOwnerNotifier, 
    LeadsRepository,
    LeadScope,
    LeadsService,
    LeadActionsService,
    LeadIntakeService,
    SavedFiltersService,
    LeadImportService,
    LeadReportingService,
    { provide: USER_LEADS_PORT, useClass: UserLeadsAdapter },
  ],
  exports: [LeadsService, LeadActionsService, LeadIntakeService, LeadScope, LeadReportingService],
})
export class LeadsModule {}
