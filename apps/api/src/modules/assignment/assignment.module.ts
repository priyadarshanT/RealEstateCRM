import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { LeadsModule } from '../leads/leads.module';
import { OrganizationModule } from '../organization/organization.module';
import { SettingsModule } from '../settings/settings.module';
import { AssignmentController } from './assignment.controller';
import { AssignmentService } from './assignment.service';

/** Rotation rules: assignment by shift, rotation of unanswered leads and fallback (Global Configuration › Leads). */
@Module({
  imports: [LeadsModule, OrganizationModule, SettingsModule, AttendanceModule],
  controllers: [AssignmentController],
  providers: [AssignmentService],
  exports: [AssignmentService],
})
export class AssignmentModule {}
