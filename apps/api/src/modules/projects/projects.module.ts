import { Module } from '@nestjs/common';
import { OrganizationModule } from '../organization/organization.module';
import { CustomFieldsController, CustomFieldsService } from './custom-fields';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { UnitsService } from './units.service';

/** Projects and units (SRS §6.1–6.4): developers, projects, buildings, units, unit price and status history. */
@Module({
  imports: [OrganizationModule],
  controllers: [ProjectsController, CustomFieldsController],
  providers: [ProjectsService, UnitsService, CustomFieldsService],
  exports: [ProjectsService, UnitsService, CustomFieldsService],
})
export class ProjectsModule {}
