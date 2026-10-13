import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PageInfo, PageQuery } from '../../../core/http/pagination';
import { IsUuid } from '../../../core/http/validators';
import { CampaignRow } from '../messaging.schema';

const STATUSES = ['draft', 'pending_approval', 'approved', 'rejected', 'sending', 'completed', 'cancelled'] as const;

// ---------------------------------------------------------------- components.schemas.MessageCampaign
export class CampaignDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['whatsapp', 'email'] }) channel!: 'whatsapp' | 'email';
  @ApiProperty({ format: 'uuid' }) templateId!: string;
  @ApiPropertyOptional({ format: 'uuid' }) integrationId!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) audienceFilter!: Record<string, unknown>;
  @ApiPropertyOptional({ type: Number, nullable: true, readOnly: true }) audienceCount!: number | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) scheduledAt!: string | null;
  @ApiProperty({ enum: STATUSES, readOnly: true }) status!: CampaignRow['status'];
  @ApiPropertyOptional({ format: 'uuid', readOnly: true }) createdBy!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, readOnly: true }) approvedBy!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) rejectionNote!: string | null;

  static from(c: CampaignRow): CampaignDto {
    return {
      id: c.id,
      name: c.name,
      channel: c.channel,
      templateId: c.templateId,
      integrationId: c.integrationId,
      audienceFilter: c.audienceFilter,
      audienceCount: c.audienceCount,
      scheduledAt: c.scheduledAt?.toISOString() ?? null,
      status: c.status,
      createdBy: c.createdBy,
      approvedBy: c.approvedBy,
      rejectionNote: c.rejectionNote,
    };
  }
}

export class CampaignPage {
  @ApiProperty({ type: [CampaignDto] }) data!: CampaignDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class CampaignListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(STATUSES) status?: CampaignRow['status'];
}

/** POST and PATCH /message-campaigns (body: MessageCampaign). Read-only fields are accepted but ignored. */
export class CampaignInputDto {
  @IsOptional() id?: unknown;
  @IsOptional() status?: unknown;
  @IsOptional() audienceCount?: unknown;
  @IsOptional() createdBy?: unknown;
  @IsOptional() approvedBy?: unknown;
  @IsOptional() rejectionNote?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional({ enum: ['whatsapp', 'email'] }) @IsOptional() @IsIn(['whatsapp', 'email']) channel?: 'whatsapp' | 'email';
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() templateId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() integrationId?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @IsOptional() @IsObject() audienceFilter?: Record<string, unknown>;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  scheduledAt?: string | null;
}

export class AudiencePreviewDto {
  @ApiProperty() count!: number;
  @ApiProperty() excludedOptedOut!: number;
  @ApiProperty({ type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } } })
  sample!: { id: string; name: string }[];
}

export class CampaignTestDto {
  @ApiProperty({ description: 'Phone (E.164) for WhatsApp or email address' }) @IsString() @MinLength(3) @MaxLength(320) to!: string;
}

export class CampaignRejectDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(1000) note!: string;
}

export class CampaignReportDto {
  @ApiProperty() audience!: number;
  @ApiProperty() skippedOptedOut!: number;
  @ApiProperty() sent!: number;
  @ApiProperty() delivered!: number;
  @ApiProperty() failed!: number;
  @ApiProperty() replied!: number;
  @ApiProperty() optedOut!: number;
}
