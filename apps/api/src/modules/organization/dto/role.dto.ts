import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUuid } from '../../../core/http/validators';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { RoleRow } from '../organization.schema';

const SCOPES = ['own', 'team', 'division', 'company'] as const;

// components.schemas.Role
export class RoleDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ pattern: '^[a-z_]+$' }) key!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: SCOPES }) dataScope!: RoleRow['dataScope'];
  @ApiPropertyOptional({ readOnly: true }) isSystem!: boolean;
  @ApiProperty({ type: [String] }) permissions!: string[];

  static from(r: RoleRow, permissions: string[]): RoleDto {
    return { id: r.id, key: r.key, name: r.name, dataScope: r.dataScope, isSystem: r.isSystem, permissions: [...permissions].sort() };
  }
}

export class RoleList {
  @ApiProperty({ type: [RoleDto] }) data!: RoleDto[];
}

/** POST /roles (body: Role; id and isSystem are read-only and ignored). */
export class CreateRoleDto {
  @IsOptional() @IsUuid() id?: string;
  @IsOptional() @IsBoolean() isSystem?: boolean;

  @ApiProperty({ pattern: '^[a-z_]+$' }) @Matches(/^[a-z_]+$/) @MaxLength(50) key!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @ApiProperty({ enum: SCOPES }) @IsIn(SCOPES) dataScope!: RoleRow['dataScope'];
  @ApiProperty({ type: [String] }) @IsArray() @ArrayUnique() @ArrayMaxSize(100) @IsString({ each: true }) permissions!: string[];
}

/** PATCH /roles/{id}. The key of a built-in role cannot change. */
export class UpdateRoleDto {
  @IsOptional() @IsUuid() id?: string;
  @IsOptional() @IsBoolean() isSystem?: boolean;

  @ApiPropertyOptional({ pattern: '^[a-z_]+$' }) @IsOptional() @Matches(/^[a-z_]+$/) @MaxLength(50) key?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @ApiPropertyOptional({ enum: SCOPES }) @IsOptional() @IsIn(SCOPES) dataScope?: RoleRow['dataScope'];
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  permissions?: string[];
}

// components.schemas.Permission
export class PermissionDto {
  @ApiProperty() key!: string;
  @ApiProperty() module!: string;
  @ApiProperty() description!: string;
}

export class PermissionList {
  @ApiProperty({ type: [PermissionDto] }) data!: PermissionDto[];
}
