import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { LeadsModule } from '../leads/leads.module';
import { OrganizationModule } from '../organization/organization.module';
import { SettingsModule } from '../settings/settings.module';
import { AssignmentController } from './assignment.controller';
import { AssignmentService } from './assignment.service';

/** Round-robin and rule-based assignment, unassigned queue, 10-minute rule escalation (SRS §3.4–3.7, §4.8–4.10). */
@Module({
  imports: [LeadsModule, OrganizationModule, SettingsModule, AttendanceModule],
  controllers: [AssignmentController],
  providers: [AssignmentService],
  exports: [AssignmentService],
})
export class AssignmentModule {}
