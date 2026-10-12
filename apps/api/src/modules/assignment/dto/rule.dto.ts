import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { IsUuid } from '../../../core/http/validators';
import { RuleRow } from '../assignment.schema';

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
}

export class ReorderRulesDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayUnique() @ArrayMaxSize(500) @IsUuid({ each: true }) ruleIds!: string[];
}
