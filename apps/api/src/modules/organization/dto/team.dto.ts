import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUuid } from '../../../core/http/validators';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PageInfo } from '../../../core/http/pagination';
import { DivisionRow, TeamRow } from '../organization.schema';

const nullableUuid = { type: String, format: 'uuid', nullable: true } as const;

// components.schemas.Team
export class TeamDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional(nullableUuid) divisionId!: string | null;
  @ApiPropertyOptional(nullableUuid) salesManagerUserId!: string | null;
  @ApiPropertyOptional(nullableUuid) teamLeaderUserId!: string | null;
  @ApiPropertyOptional() isActive!: boolean;

  static from(t: TeamRow): TeamDto {
    return {
      id: t.id,
      name: t.name,
      divisionId: t.divisionId,
      salesManagerUserId: t.salesManagerUserId,
      teamLeaderUserId: t.teamLeaderUserId,
      isActive: t.isActive,
    };
  }
}

export class TeamPage {
  @ApiProperty({ type: [TeamDto] }) data!: TeamDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

/** POST and PATCH /teams (body: Team; id is read-only and ignored). `name` is required on create. */
export class TeamInputDto {
  @IsOptional() @IsUuid() id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() divisionId?: string | null;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() salesManagerUserId?: string | null;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() teamLeaderUserId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// components.schemas.Division
export class DivisionDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional(nullableUuid) gmUserId!: string | null;
  @ApiPropertyOptional() isActive!: boolean;

  static from(d: DivisionRow): DivisionDto {
    return { id: d.id, name: d.name, gmUserId: d.gmUserId, isActive: d.isActive };
  }
}

export class DivisionPage {
  @ApiProperty({ type: [DivisionDto] }) data!: DivisionDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

/** POST and PATCH /divisions (body: Division). `name` is required on create. */
export class DivisionInputDto {
  @IsOptional() @IsUuid() id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() gmUserId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
