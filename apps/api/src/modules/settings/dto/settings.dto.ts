import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageInfo, PageQuery } from '../../../core/http/pagination';
import { IsDateOnly, IsUuid } from '../../../core/http/validators';
import { LEAD_SOURCE_TYPES, LeadSourceRow, LeadStageRow, LeadSubstatusRow, ReasonRow, SettingRow } from '../settings.schema';

const nullableUuid = { type: String, format: 'uuid', nullable: true } as const;
const CATEGORIES = ['open', 'won', 'lost', 'invalid'] as const;
const REASON_TYPES = ['lost', 'invalid', 'reassignment'] as const;

// ---- settings (components.schemas.Setting)
export class SettingDto {
  @ApiProperty() key!: string;
  @ApiProperty({ type: Object }) value!: Record<string, unknown>;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, readOnly: true, description: 'Empty while the default is used' }) updatedAt!: string | null;

  static from(r: SettingRow): SettingDto {
    return { key: r.key, value: r.value, updatedAt: r.updatedAt.toISOString() };
  }
}

export class SettingList {
  @ApiProperty({ type: [SettingDto] }) data!: SettingDto[];
}

/** One change in a setting's history (Global Configuration §9). */
export class SettingChangeDto {
  @ApiProperty({ format: 'date-time' }) at!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) userId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) userName!: string | null;
  @ApiPropertyOptional({ nullable: true }) before!: unknown;
  @ApiPropertyOptional({ nullable: true }) after!: unknown;
}

export class SettingChangeList {
  @ApiProperty({ type: [SettingChangeDto] }) data!: SettingChangeDto[];
}

/** GET /client-policy: the Global Configuration switches every screen follows (the API enforces them too). */
export class ClientPolicyDto {
  @ApiProperty() allowCopyPaste!: boolean;
  @ApiProperty() exportLeads!: boolean;
  @ApiProperty() sourceUpdate!: boolean;
  @ApiProperty() pastDateSelection!: boolean;
  @ApiProperty() mandatoryLocation!: boolean;
  @ApiProperty() unassignedCommunication!: boolean;
  @ApiProperty() dualOwnership!: boolean;
  @ApiProperty({ pattern: '^[A-Z]{2}$' }) defaultCountry!: string;
  @ApiProperty({ pattern: '^[A-Z]{3}$' }) defaultCurrency!: string;
}

export class UpdateSettingDto {
  @ApiProperty({ type: Object }) @IsObject() value!: Record<string, unknown>;
}

// ---- currencies
export class CurrencyDto {
  @ApiProperty({ pattern: '^[A-Z]{3}$', example: 'AED' }) code!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) rateToBase!: string | null;
}

export class CurrencyList {
  @ApiProperty({ type: [CurrencyDto] }) data!: CurrencyDto[];
}

export class CurrencyInput {
  @ApiProperty({ pattern: '^[A-Z]{3}$', example: 'AED' }) @Matches(/^[A-Z]{3}$/) code!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{1,10}(\.\d{1,8})?$/, { message: 'rateToBase must be a positive decimal string' }) rateToBase?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() effectiveDate?: string;
}

export class SetCurrenciesDto {
  @ApiPropertyOptional({ type: [CurrencyInput] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CurrencyInput)
  currencies!: CurrencyInput[];
}

export class CurrencyCodes {
  @ApiProperty({ type: [String] }) data!: string[];
}

// ---- lead statuses (components.schemas.LeadStage): the four fixed statuses Hot, Warm, Cold, Sale Done
export class LeadStageDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ enum: ['hot', 'warm', 'cold', 'sale_done'] }) key!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: CATEGORIES }) category!: LeadStageRow['category'];
  @ApiProperty() sortOrder!: number;
  @ApiPropertyOptional({ readOnly: true }) isSystem!: boolean;
  @ApiPropertyOptional() isActive!: boolean;
  @ApiProperty({ pattern: '^#[0-9a-fA-F]{6}$' }) color!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ description: 'Moving a lead here needs a date and time' }) requiresScheduling!: boolean;

  static from(r: LeadStageRow): LeadStageDto {
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      category: r.category,
      sortOrder: r.sortOrder,
      isSystem: r.isSystem,
      isActive: r.isActive,
      color: r.color,
      description: r.description,
      requiresScheduling: r.requiresScheduling,
    };
  }
}

export class LeadStagePage {
  @ApiProperty({ type: [LeadStageDto] }) data!: LeadStageDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

// ---- substatuses (components.schemas.LeadSubstatus)
export class LeadSubstatusDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) stageId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() requiresScheduling!: boolean;

  static from(r: LeadSubstatusRow): LeadSubstatusDto {
    return { id: r.id, stageId: r.stageId, name: r.name, sortOrder: r.sortOrder, isActive: r.isActive, requiresScheduling: r.requiresScheduling };
  }
}

export class LeadSubstatusList {
  @ApiProperty({ type: [LeadSubstatusDto] }) data!: LeadSubstatusDto[];
}

export class SubstatusListQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() stageId?: string;
}

/** POST and PATCH /lead-substatuses. stageId and name are required on create. */
export class LeadSubstatusInputDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() stageId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresScheduling?: boolean;
}

/** PUT /lead-substatuses/order: the substatuses of one status in their new order. */
export class SubstatusOrderDto {
  @ApiProperty({ format: 'uuid' }) @IsUuid() stageId!: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(100) @IsUuid({ each: true }) ids!: string[];
}

// ---- reasons (components.schemas.Reason)
export class ReasonDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ enum: REASON_TYPES }) type!: ReasonRow['type'];
  @ApiPropertyOptional({ type: String, nullable: true }) key!: string | null;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() isActive!: boolean;

  static from(r: ReasonRow): ReasonDto {
    return { id: r.id, type: r.type, key: r.key, name: r.name, isActive: r.isActive };
  }
}

export class ReasonPage {
  @ApiProperty({ type: [ReasonDto] }) data!: ReasonDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class ReasonListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: REASON_TYPES }) @IsOptional() @IsIn(REASON_TYPES) type?: ReasonRow['type'];
}

/** POST and PATCH /reasons. type and name are required on create. Keys are reserved for built-in reasons. */
export class ReasonInputDto {
  @IsOptional() @IsUuid() id?: string;
  @ApiPropertyOptional({ enum: REASON_TYPES }) @IsOptional() @IsIn(REASON_TYPES) type?: ReasonRow['type'];
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^[a-z_]+$/) key?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---- lead sources (components.schemas.LeadSource)
export class LeadSourceDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ enum: LEAD_SOURCE_TYPES }) type!: LeadSourceRow['type'];
  @ApiProperty() name!: string;
  @ApiPropertyOptional(nullableUuid) integrationId!: string | null;
  @ApiPropertyOptional({ minimum: 0, maximum: 100 }) qualityScore!: number;
  @ApiPropertyOptional() isActive!: boolean;

  static from(r: LeadSourceRow): LeadSourceDto {
    return { id: r.id, type: r.type, name: r.name, integrationId: r.integrationId, qualityScore: r.qualityScore, isActive: r.isActive };
  }
}

export class LeadSourcePage {
  @ApiProperty({ type: [LeadSourceDto] }) data!: LeadSourceDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

/** POST and PATCH /lead-sources. type and name are required on create. */
export class LeadSourceInputDto {
  @IsOptional() @IsUuid() id?: string;
  @ApiPropertyOptional({ enum: LEAD_SOURCE_TYPES }) @IsOptional() @IsIn(LEAD_SOURCE_TYPES) type?: LeadSourceRow['type'];
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() integrationId?: string | null;
  @ApiPropertyOptional({ minimum: 0, maximum: 100 }) @IsOptional() @IsInt() @Min(0) @Max(100) qualityScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
