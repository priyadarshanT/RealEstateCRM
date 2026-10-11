import { Controller, Get, Query } from '@nestjs/common';
import { IsUuid } from '../http/validators';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePermission } from '../auth/decorators';
import { PageInfo, PageQuery } from '../http/pagination';
import { AuditEntry, AuditService } from './audit.service';

class AuditQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) entityType?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() entityId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) action?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) to?: string;
}

class AuditEntryDto implements AuditEntry {
  @ApiProperty() id!: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) userId!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty() entityType!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) entityId!: string | null;
  @ApiPropertyOptional({ type: Object, nullable: true }) changes!: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: String, nullable: true }) ipAddress!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

class AuditPage {
  @ApiProperty({ type: [AuditEntryDto] }) data!: AuditEntryDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

@ApiTags('Audit')
@ApiBearerAuth('bearer')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit.view')
  @ApiOperation({ operationId: 'listAuditLog', summary: 'Audit log' })
  @ApiOkResponse({ type: AuditPage })
  list(@Query() query: AuditQuery): Promise<AuditPage> {
    return this.audit.list(query);
  }
}
