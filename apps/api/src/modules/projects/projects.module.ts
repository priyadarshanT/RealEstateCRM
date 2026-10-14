import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { UnitsService } from './units.service';

/** Projects and units (SRS §6.1–6.4): developers, projects, buildings, units, unit price and status history. */
@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, UnitsService],
  exports: [ProjectsService, UnitsService],
})
export class ProjectsModule {}
