import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TenantRow, UserRow } from '../organization.schema';

// Response shapes from api/openapi.yaml (components.schemas.User, Tenant, Me).

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

export class MeDto {
  @ApiProperty({ type: UserDto }) user!: UserDto;
  @ApiProperty({ type: TenantDto }) tenant!: TenantDto;
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty({ enum: ['own', 'team', 'division', 'company'] }) dataScope!: 'own' | 'team' | 'division' | 'company';
}
