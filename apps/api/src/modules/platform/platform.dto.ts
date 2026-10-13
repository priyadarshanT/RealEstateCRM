import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PageInfo, PageQuery } from '../../core/http/pagination';
import { IsDateOnly, IsUuid } from '../../core/http/validators';
import { BillingUsageDto, SubscriptionDto } from '../billing/dto/billing.dto';

const MONEY = /^\d+(\.\d{1,2})?$/;
const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class PlatformAdminDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty({ enum: ['owner', 'support', 'billing'] }) role!: string;
}

export class PlatformMetricsDto {
  @ApiProperty() mrr!: string;
  @ApiPropertyOptional() arr!: string;
  @ApiProperty() payingTenants!: number;
  @ApiProperty() trialingTenants!: number;
  @ApiPropertyOptional() pastDueTenants!: number;
  @ApiPropertyOptional() readOnlyTenants!: number;
  @ApiProperty() paidSeats!: number;
  @ApiPropertyOptional() newTrials30d!: number;
  @ApiPropertyOptional() trialConversion30d!: number;
  @ApiPropertyOptional() churned30d!: number;
  @ApiPropertyOptional() pendingBankTransfers!: number;
  @ApiPropertyOptional() pendingVerifications!: number;
}

export class PlatformTenantDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['brokerage', 'individual'] }) type!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) legalName!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) tradeLicenseNo!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) reraOrn!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) reraBrn!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) tradeLicenseFileId!: string | null;
  @ApiProperty({ enum: ['pending', 'verified', 'rejected'] }) verificationStatus!: string;
  @ApiProperty({ enum: ['active', 'suspended', 'closed'] }) status!: string;
  @ApiProperty({ type: SubscriptionDto }) subscription!: SubscriptionDto;
  @ApiPropertyOptional({ type: BillingUsageDto }) usage!: BillingUsageDto;
  @ApiPropertyOptional() adminEmail?: string;
  @ApiPropertyOptional({ format: 'date-time', readOnly: true }) createdAt!: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) lastActiveAt!: string | null;
}

export class PlatformTenantPage {
  @ApiProperty({ type: [PlatformTenantDto] }) data!: PlatformTenantDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class TenantListQuery extends PageQuery {
  @ApiPropertyOptional({ description: 'Name, email, licence' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: ['trialing', 'active', 'past_due', 'read_only', 'canceled'] })
  @IsOptional()
  @IsIn(['trialing', 'active', 'past_due', 'read_only', 'canceled'])
  subscriptionStatus?: 'trialing' | 'active' | 'past_due' | 'read_only' | 'canceled';
  @ApiPropertyOptional({ enum: ['pending', 'verified', 'rejected'] }) @IsOptional() @IsIn(['pending', 'verified', 'rejected']) verificationStatus?: 'pending' | 'verified' | 'rejected';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) planKey?: string;
}

export class VerifyDto {
  @ApiProperty({ enum: ['verified', 'rejected'] }) @IsIn(['verified', 'rejected']) result!: 'verified' | 'rejected';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class PlatformReasonDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(2000) reason!: string;
}

export class ExtendDto {
  @ApiProperty({ minimum: 1, maximum: 90 }) @IsInt() @Min(1) @Max(90) days!: number;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(2000) note!: string;
}

export class SubscriptionPatchDto {
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY) pricePerSeat?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100_000) seats?: number;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() planId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class EnquiryListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['new', 'contacted', 'won', 'lost'] }) @IsOptional() @IsIn(['new', 'contacted', 'won', 'lost']) status?: string;
}

export class EnquiryPatchDto {
  @ApiPropertyOptional({ enum: ['new', 'contacted', 'won', 'lost'] }) @IsOptional() @IsIn(['new', 'contacted', 'won', 'lost']) status?: 'new' | 'contacted' | 'won' | 'lost';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class CreateCompanyDto {
  @ApiProperty({ enum: ['brokerage', 'individual'] }) @IsIn(['brokerage', 'individual']) tenantType!: 'brokerage' | 'individual';
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) companyName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) tradeLicenseNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) reraOrn?: string;
  @ApiProperty() @Transform(lowerTrim) @IsEmail() adminEmail!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) adminFullName!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100_000) seats!: number;
  @ApiProperty() @Matches(MONEY) pricePerSeat!: string;
  @ApiProperty({ enum: ['monthly', 'yearly'] }) @IsIn(['monthly', 'yearly']) billingCycle!: 'monthly' | 'yearly';
  @ApiProperty({ enum: ['card', 'bank_transfer'] }) @IsIn(['card', 'bank_transfer']) paymentMethod!: 'card' | 'bank_transfer';
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(90) trialDays?: number;
}

export class InvoiceListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() tenantId?: string;
  @ApiPropertyOptional({ enum: ['open', 'paid', 'void', 'uncollectible'] }) @IsOptional() @IsIn(['open', 'paid', 'void', 'uncollectible']) status?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() to?: string;
}

export class ConfirmTransferDto {
  @ApiProperty({ format: 'date-time' }) @IsDateString() receivedAt!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY) amount?: string;
}

/** POST and PATCH /platform/plans (body: Plan). key, name and prices are required on create. */
export class PlanInputDto {
  @IsOptional() id?: unknown;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z_]+$/) @MaxLength(50) key?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) description?: string | null;
  @ApiPropertyOptional({ enum: ['brokerage', 'individual'], nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(['brokerage', 'individual']) tenantType?: 'brokerage' | 'individual' | null;
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY) priceMonthly?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY) priceYearly?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) minSeats?: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) maxSeats?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() selfService?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AuditQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() tenantId?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() to?: string;
}
