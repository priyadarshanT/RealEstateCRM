import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AllowWhenReadOnly, CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { PageQuery } from '../../core/http/pagination';
import { IsDateOnly, IsUuid } from '../../core/http/validators';
import { DashboardModule, FiltersQuery } from '../dashboard/dashboard.service';
import { EventsModule } from '../events/events.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { MessagingModule } from '../messaging/messaging.module';
import { LeadsModule } from '../leads/leads.module';
import { MarketingModule } from '../marketing/marketing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationModule } from '../organization/organization.module';
import { TasksModule } from '../tasks/tasks.module';
import { ExportDto, ExportPage, ExportRequestDto, ReportList, ReportResultDto, ReportsService } from './reports.service';

class RunReportQuery extends FiltersQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit: number = 50;
}

class ExportLogQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() userId?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() to?: string;
}

@ApiTags('Reports')
@ApiBearerAuth('bearer')
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listReports', summary: 'Available reports' })
  @ApiOkResponse({ type: ReportList })
  list(@CurrentPrincipal() p: Principal): ReportList {
    return { data: this.reports.list(p) };
  }

  @Get('reports/:key')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'runReport', summary: 'Run a report' })
  @ApiOkResponse({ type: ReportResultDto })
  run(@CurrentPrincipal() p: Principal, @Param('key') key: string, @Query() query: RunReportQuery): Promise<ReportResultDto> {
    const { cursor, limit, ...filters } = query;
    return this.reports.run(p, key, filters, limit, cursor);
  }

  @Post('reports/:key/exports')
  @HttpCode(202)
  @AllowWhenReadOnly()
  @ApiOperation({ operationId: 'exportReport', summary: 'Export a report (Admin)' })
  @ApiAcceptedResponse({ type: ExportDto })
  export(@CurrentPrincipal() p: Principal, @Param('key') key: string, @Body() body: ExportRequestDto): Promise<ExportDto> {
    return this.reports.requestExport(p, key, body);
  }

  @Get('exports')
  @RequirePermission('audit.view')
  @ApiOperation({ operationId: 'listExportLog', summary: 'Export log' })
  @ApiOkResponse({ type: ExportPage })
  log(@Query() query: ExportLogQuery): Promise<ExportPage> {
    return this.reports.log(query.limit, query.cursor, query.userId, query.from, query.to);
  }

  @Get('exports/:id')
  @ApiOperation({ operationId: 'getExport', summary: 'Export status and download link' })
  @ApiOkResponse({ type: ExportDto })
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<ExportDto> {
    return this.reports.getExport(p, id);
  }
}

/** Reports, exports and the export log (SRS §8). */
@Module({
  imports: [LeadsModule, TasksModule, MarketingModule, EventsModule, DashboardModule, NotificationsModule, OrganizationModule, MessagingModule, IntegrationsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
