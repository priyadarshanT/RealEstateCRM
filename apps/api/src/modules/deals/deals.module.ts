import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { OrganizationModule } from '../organization/organization.module';
import { ProjectsModule } from '../projects/projects.module';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';

/** Deals (SRS §6.5): offer → EOI → booking → sold, moving the unit and recording each step on the lead. */
@Module({
  imports: [LeadsModule, ProjectsModule, OrganizationModule],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
