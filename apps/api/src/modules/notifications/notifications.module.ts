import { Module } from '@nestjs/common';
import { OrganizationModule } from '../organization/organization.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** In-app notifications and push devices. */
@Module({
  imports: [OrganizationModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
