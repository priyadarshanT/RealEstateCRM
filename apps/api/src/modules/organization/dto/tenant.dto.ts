import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUuid } from '../../../core/http/validators';
import { IsEmail, IsIn, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { TenantRow } from '../organization.schema';

// components.schemas.Tenant in api/openapi.yaml
export class TenantDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ enum: ['brokerage', 'individual'] }) type!: TenantRow['type'];
  @ApiProperty() name!: string;
  @ApiPropertyOptional() legalName?: string;
  @ApiPropertyOptional() tradeLicenseNo?: string;
  @ApiPropertyOptional() reraOrn?: string;
  @ApiPropertyOptional() reraBrn?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) tradeLicenseFileId!: string | null;
  @ApiProperty({ enum: ['pending', 'verified', 'rejected'], readOnly: true }) verificationStatus!: TenantRow['verificationStatus'];
  @ApiPropertyOptional() trn?: string;
  @ApiPropertyOptional() email?: string;
  @ApiPropertyOptional() phone?: string;
  @ApiPropertyOptional() address?: string;
  @ApiPropertyOptional() website?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) logoFileId!: string | null;
  @ApiProperty() timezone!: string;
  @ApiProperty({ pattern: '^[A-Z]{3}$', example: 'AED' }) baseCurrency!: string;

  static from(t: TenantRow): TenantDto {
    const optional = (v: string | null) => v ?? undefined;
    return {
      id: t.id,
      type: t.type,
      name: t.name,
      legalName: optional(t.legalName),
      tradeLicenseNo: optional(t.tradeLicenseNo),
      reraOrn: optional(t.reraOrn),
      reraBrn: optional(t.reraBrn),
      tradeLicenseFileId: t.tradeLicenseFileId,
      verificationStatus: t.verificationStatus,
      trn: optional(t.trn),
      email: optional(t.email),
      phone: optional(t.phone),
      address: optional(t.address),
      website: optional(t.website),
      logoFileId: t.logoFileId,
      timezone: t.timezone,
      baseCurrency: t.baseCurrency,
    };
  }
}

/**
 * PATCH /organization. The body is the Tenant schema; only the columns the app may change
 * (security.sql grants) are applied. id, type and verificationStatus are accepted but ignored.
 */
export class UpdateTenantDto {
  @IsOptional() @IsUuid() id?: string;
  @IsOptional() @IsIn(['brokerage', 'individual']) type?: string;
  @IsOptional() @IsIn(['pending', 'verified', 'rejected']) verificationStatus?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) legalName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) tradeLicenseNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) reraOrn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) reraBrn?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUuid()
  tradeLicenseFileId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) trn?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+[1-9][0-9]{6,14}$/, { message: 'phone must be in E.164 format' }) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() website?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUuid()
  logoFileId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @ApiPropertyOptional({ pattern: '^[A-Z]{3}$' }) @IsOptional() @Matches(/^[A-Z]{3}$/) baseCurrency?: string;
}
