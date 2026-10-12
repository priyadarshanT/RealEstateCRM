import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentPrincipal } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { Problems } from '../../core/errors/problem';
import { PageInfo, PageQuery } from '../../core/http/pagination';
import { NotificationsService } from './notifications.service';

class NotificationQuery extends PageQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  unread?: boolean;
}

class NotificationDtoDoc {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() type!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) body!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) leadId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) linkPath!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) readAt!: string | null;
  @ApiProperty({ format: 'date-time', readOnly: true }) createdAt!: string;
}

class NotificationPage {
  @ApiProperty({ type: [NotificationDtoDoc] }) data!: NotificationDtoDoc[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

class PushDeviceDto {
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(4096) fcmToken!: string;
  @ApiProperty({ enum: ['android', 'ios', 'web'] }) @IsIn(['android', 'ios', 'web']) platform!: 'android' | 'ios' | 'web';
}

@ApiTags('Notifications')
@ApiBearerAuth('bearer')
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  @ApiOperation({ operationId: 'listNotifications', summary: 'My notifications' })
  @ApiOkResponse({ type: NotificationPage })
  list(@CurrentPrincipal() p: Principal, @Query() query: NotificationQuery): Promise<NotificationPage> {
    return this.notifications.list(p.userId, query.limit, query.cursor, query.unread);
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  @ApiOperation({ operationId: 'markAllNotificationsRead', summary: 'Mark all as read' })
  @ApiNoContentResponse({ description: 'Done' })
  readAll(@CurrentPrincipal() p: Principal): Promise<void> {
    return this.notifications.markAllRead(p.userId);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  @ApiOperation({ operationId: 'markNotificationRead', summary: 'Mark as read' })
  @ApiNoContentResponse({ description: 'Done' })
  async read(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    if (!(await this.notifications.markRead(p.userId, id))) throw Problems.notFound();
  }

  @Post('push-devices')
  @HttpCode(204)
  @ApiOperation({ operationId: 'registerPushDevice', summary: 'Register this device for push' })
  @ApiNoContentResponse({ description: 'Done' })
  register(@CurrentPrincipal() p: Principal, @Body() body: PushDeviceDto): Promise<void> {
    return this.notifications.registerDevice(p.userId, body.fcmToken, body.platform);
  }

  @Delete('push-devices/:token')
  @HttpCode(204)
  @ApiOperation({ operationId: 'removePushDevice', summary: 'Stop push to this device' })
  @ApiNoContentResponse({ description: 'Done' })
  async remove(@CurrentPrincipal() p: Principal, @Param('token') token: string): Promise<void> {
    if (!(await this.notifications.removeDevice(p.userId, token))) throw Problems.notFound();
  }
}
