import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
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
import { IsUuid } from '../../../core/http/validators';
import { LEAD_SOURCE_TYPES, LeadSourceRow, LeadStageRow, ReasonRow, SettingRow } from '../settings.schema';

const nullableUuid = { type: String, format: 'uuid', nullable: true } as const;
const CATEGORIES = ['open', 'won', 'lost', 'invalid'] as const;
const REASON_TYPES = ['lost', 'invalid', 'reassignment'] as const;

// ---- settings (components.schemas.Setting)
export class SettingDto {
  @ApiProperty() key!: string;
  @ApiProperty({ type: Object }) value!: Record<string, unknown>;
  @ApiPropertyOptional({ format: 'date-time', readOnly: true }) updatedAt!: string;

  static from(r: SettingRow): SettingDto {
    return { key: r.key, value: r.value, updatedAt: r.updatedAt.toISOString() };
  }
}

export class SettingList {
  @ApiProperty({ type: [SettingDto] }) data!: SettingDto[];
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
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) effectiveDate?: string;
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

// ---- lead stages (components.schemas.LeadStage)
export class LeadStageDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: CATEGORIES }) category!: LeadStageRow['category'];
  @ApiProperty() sortOrder!: number;
  @ApiPropertyOptional({ readOnly: true }) isSystem!: boolean;
  @ApiPropertyOptional() isActive!: boolean;

  static from(r: LeadStageRow): LeadStageDto {
    return { id: r.id, key: r.key, name: r.name, category: r.category, sortOrder: r.sortOrder, isSystem: r.isSystem, isActive: r.isActive };
  }
}

export class LeadStagePage {
  @ApiProperty({ type: [LeadStageDto] }) data!: LeadStageDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

/** POST and PATCH /lead-stages. key, name, category and sortOrder are required on create. */
export class LeadStageInputDto {
  @IsOptional() @IsUuid() id?: string;
  @IsOptional() @IsBoolean() isSystem?: boolean;
  @ApiPropertyOptional({ pattern: '^[a-z_]+$' }) @IsOptional() @Matches(/^[a-z_]+$/) @MaxLength(50) key?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @ApiPropertyOptional({ enum: CATEGORIES }) @IsOptional() @IsIn(CATEGORIES) category?: LeadStageRow['category'];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
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
