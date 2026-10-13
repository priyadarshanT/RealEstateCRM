import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUuid } from '../../../core/http/validators';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PageInfo, PageQuery } from '../../../core/http/pagination';
import { UserRow } from '../organization.schema';

const E164 = /^\+[1-9][0-9]{6,14}$/;
const LANGUAGE = /^[a-z]{2}$/;
const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

// components.schemas.User in api/openapi.yaml
export class UserDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty() fullName!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ format: 'uuid' }) roleId!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) teamId!: string | null;
  @ApiProperty({ enum: ['invited', 'active', 'inactive'] }) status!: UserRow['status'];
  @ApiProperty() receivesLeads!: boolean;
  @ApiPropertyOptional({ type: [String] }) languages!: string[];
  @ApiPropertyOptional({ type: String, nullable: true }) location!: string | null;
  @ApiPropertyOptional() timezone!: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, readOnly: true }) lastLoginAt!: string | null;

  static from(u: UserRow): UserDto {
    return {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      phone: u.phone,
      roleId: u.roleId,
      teamId: u.teamId,
      status: u.status,
      receivesLeads: u.receivesLeads,
      languages: u.languages,
      location: u.location,
      timezone: u.timezone,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    };
  }
}

export class UserPage {
  @ApiProperty({ type: [UserDto] }) data!: UserDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

// components.schemas.Colleague: name and team only, for share and assign pickers (no email, phone or role).
export class ColleagueDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) teamId!: string | null;

  static from(u: Pick<UserRow, 'id' | 'fullName' | 'teamId'>): ColleagueDto {
    return { id: u.id, fullName: u.fullName, teamId: u.teamId };
  }
}

export class ColleagueList {
  @ApiProperty({ type: [ColleagueDto] }) data!: ColleagueDto[];
}

export class UserListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['invited', 'active', 'inactive'] })
  @IsOptional()
  @IsIn(['invited', 'active', 'inactive'])
  status?: UserRow['status'];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() roleId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
}

// components.schemas.UserCreate
export class CreateUserDto {
  @ApiProperty({ format: 'email' }) @Transform(lowerTrim) @IsEmail() email!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) fullName!: string;
  @ApiPropertyOptional({ pattern: E164.source }) @IsOptional() @Matches(E164, { message: 'phone must be in E.164 format' }) phone?: string;
  @ApiProperty({ format: 'uuid' }) @IsUuid() roleId!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() teamId?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(LANGUAGE, { each: true, message: 'languages must be ISO 639-1 codes' })
  languages?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) location?: string;
}

/**
 * PATCH /users/{id}. The body is the User schema. Status and lead assignment have their own endpoints
 * (deactivate, reactivate, receives-leads), so status, receivesLeads, id and lastLoginAt are accepted but ignored.
 */
export class UpdateUserDto {
  @IsOptional() @IsUuid() id?: string;
  @IsOptional() @IsIn(['invited', 'active', 'inactive']) status?: string;
  @IsOptional() @IsBoolean() receivesLeads?: boolean;
  @IsOptional() lastLoginAt?: unknown;

  @ApiPropertyOptional({ format: 'email' }) @IsOptional() @Transform(lowerTrim) @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) fullName?: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(E164, { message: 'phone must be in E.164 format' })
  phone?: string | null;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() roleId?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUuid()
  teamId?: string | null;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(LANGUAGE, { each: true, message: 'languages must be ISO 639-1 codes' })
  languages?: string[];
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  location?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) timezone?: string;
}

export class ReceivesLeadsDto {
  @ApiProperty() @IsBoolean() receivesLeads!: boolean;
}

export class DeactivateUserDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() reassignToUserId?: string;
}
