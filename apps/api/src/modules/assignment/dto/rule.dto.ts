import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { IsUuid } from '../../../core/http/validators';
import { ROTATION_FALLBACKS, RotationFallback, RuleRow } from '../assignment.schema';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const nullableUuid = { type: String, format: 'uuid', nullable: true } as const;

export class RuleConditionsDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(200) @IsUuid({ each: true }) projectIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(200) @IsUuid({ each: true }) campaignIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(200) @IsUuid({ each: true }) sourceIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(50) @IsString({ each: true }) languages?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(100) @IsString({ each: true }) locations?: string[];
}

// components.schemas.AssignmentRule
export class AssignmentRuleDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ minimum: 1 }) priority!: number;
  @ApiProperty({ type: RuleConditionsDto }) conditions!: RuleConditionsDto;
  @ApiPropertyOptional(nullableUuid) targetTeamId!: string | null;
  @ApiPropertyOptional({ type: [String] }) memberUserIds!: string[];
  @ApiPropertyOptional() respectAvailability!: boolean;
  @ApiPropertyOptional() isActive!: boolean;
  @ApiProperty({ type: [Number], description: 'Shift days, 0 = Sunday' }) shiftDays!: number[];
  @ApiPropertyOptional({ type: String, nullable: true, example: '09:00' }) shiftStart!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: '18:00' }) shiftEnd!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Empty = company time zone' }) timezone!: string | null;
  @ApiProperty({ minimum: 1, maximum: 1440 }) rotationMinutes!: number;
  @ApiProperty({ minimum: 0, maximum: 50 }) maxRotations!: number;
  @ApiProperty({ enum: ROTATION_FALLBACKS }) fallback!: RotationFallback;
  @ApiPropertyOptional(nullableUuid) fallbackUserId!: string | null;

  static from(r: RuleRow, members: string[]): AssignmentRuleDto {
    const c = r.conditions;
    const conditions: RuleConditionsDto = {};
    if (c.project_ids?.length) conditions.projectIds = c.project_ids;
    if (c.campaign_ids?.length) conditions.campaignIds = c.campaign_ids;
    if (c.source_ids?.length) conditions.sourceIds = c.source_ids;
    if (c.languages?.length) conditions.languages = c.languages;
    if (c.locations?.length) conditions.locations = c.locations;
    return {
      id: r.id,
      name: r.name,
      priority: r.priority,
      conditions,
      targetTeamId: r.targetTeamId,
      memberUserIds: members,
      respectAvailability: r.respectAvailability,
      isActive: r.isActive,
      shiftDays: r.shiftDays,
      shiftStart: r.shiftStart?.slice(0, 5) ?? null,
      shiftEnd: r.shiftEnd?.slice(0, 5) ?? null,
      timezone: r.timezone,
      rotationMinutes: r.rotationMinutes,
      maxRotations: r.maxRotations,
      fallback: r.fallback,
      fallbackUserId: r.fallbackUserId,
    };
  }
}

export class AssignmentRuleList {
  @ApiProperty({ type: [AssignmentRuleDto] }) data!: AssignmentRuleDto[];
}

/** POST and PATCH /assignment-rules. name and conditions are required on create; priority defaults to last. */
export class AssignmentRuleInputDto {
  @IsOptional() @IsUuid() id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @ApiPropertyOptional({ minimum: 1 }) @IsOptional() @IsInt() @Min(1) priority?: number;
  @ApiPropertyOptional({ type: RuleConditionsDto }) @IsOptional() @ValidateNested() @Type(() => RuleConditionsDto) conditions?: RuleConditionsDto;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() targetTeamId?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(200) @IsUuid({ each: true }) memberUserIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() respectAvailability?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) shiftDays?: number[];
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(HHMM, { message: 'shiftStart must be HH:MM' }) shiftStart?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(HHMM, { message: 'shiftEnd must be HH:MM' }) shiftEnd?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(60) timezone?: string | null;
  @ApiPropertyOptional({ minimum: 1, maximum: 1440 }) @IsOptional() @IsInt() @Min(1) @Max(1440) rotationMinutes?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 50 }) @IsOptional() @IsInt() @Min(0) @Max(50) maxRotations?: number;
  @ApiPropertyOptional({ enum: ROTATION_FALLBACKS }) @IsOptional() @IsIn(ROTATION_FALLBACKS) fallback?: RotationFallback;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() fallbackUserId?: string | null;
}

export class ReorderRulesDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayUnique() @ArrayMaxSize(500) @IsUuid({ each: true }) ruleIds!: string[];
}
