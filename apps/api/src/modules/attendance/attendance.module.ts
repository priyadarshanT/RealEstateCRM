import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationModule } from '../organization/organization.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { LeaveService } from './leave.service';
import { PoliciesService } from './policies.service';

/** Attendance (SRS §9): check-in / out with photo, policies, holidays, leave, corrections. */
@Module({
  imports: [OrganizationModule, NotificationsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, LeaveService, PoliciesService],
  exports: [AttendanceService, LeaveService],
})
export class AttendanceModule {}
