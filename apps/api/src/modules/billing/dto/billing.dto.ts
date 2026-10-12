import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PageInfo } from '../../../core/http/pagination';
import { IsUuid } from '../../../core/http/validators';

const E164 = /^\+[1-9][0-9]{6,14}$/;
const MONEY = /^\d+(\.\d{1,2})?$/;
const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

// components.schemas.Plan
export class PlanDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description!: string | null;
  @ApiPropertyOptional({ enum: ['brokerage', 'individual'], nullable: true }) tenantType!: 'brokerage' | 'individual' | null;
  @ApiProperty() priceMonthly!: string;
  @ApiProperty() priceYearly!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() minSeats!: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) maxSeats!: number | null;
  @ApiProperty() selfService!: boolean;
  @ApiPropertyOptional() isActive!: boolean;
}

export class PlanList {
  @ApiProperty({ type: [PlanDto] }) data!: PlanDto[];
}

export class CardSetupDto {
  @ApiProperty() stripePublishableKey!: string;
  @ApiProperty() setupIntentClientSecret!: string;
}

export class InvoiceEstimateDto {
  @ApiPropertyOptional() subtotal!: string;
  @ApiPropertyOptional() vat!: string;
  @ApiPropertyOptional() total!: string;
  @ApiPropertyOptional({ format: 'date' }) date!: string | null;
}

// components.schemas.Subscription
export class SubscriptionDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ type: PlanDto }) plan!: PlanDto;
  @ApiProperty({ enum: ['trialing', 'active', 'past_due', 'read_only', 'canceled'], readOnly: true }) status!: string;
  @ApiProperty({ enum: ['monthly', 'yearly'] }) billingCycle!: 'monthly' | 'yearly';
  @ApiProperty() seats!: number;
  @ApiProperty({ readOnly: true, description: 'Active users now' }) seatsUsed!: number;
  @ApiProperty() pricePerSeat!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: ['card', 'bank_transfer'] }) paymentMethod!: 'card' | 'bank_transfer';
  @ApiPropertyOptional({ type: String, nullable: true, readOnly: true }) cardLast4!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, readOnly: true }) trialEndsAt!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, readOnly: true }) currentPeriodEnd!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, readOnly: true }) graceEndsAt!: string | null;
  @ApiProperty() cancelAtPeriodEnd!: boolean;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, readOnly: true }) dataDeleteAfter!: string | null;
  @ApiPropertyOptional({ type: InvoiceEstimateDto, readOnly: true }) nextInvoiceEstimate!: InvoiceEstimateDto;
}

export class InvoiceLineDto {
  @ApiPropertyOptional({ enum: ['subscription', 'extra_seats', 'credit'] }) type!: string;
  @ApiPropertyOptional() description!: string;
  @ApiPropertyOptional() quantity!: number;
  @ApiPropertyOptional() unitPrice!: string;
  @ApiPropertyOptional() amount!: string;
}

// components.schemas.BillingInvoice
export class BillingInvoiceDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() number!: string;
  @ApiProperty({ enum: ['open', 'paid', 'void', 'uncollectible'] }) status!: string;
  @ApiProperty({ format: 'date' }) periodStart!: string;
  @ApiProperty({ format: 'date' }) periodEnd!: string;
  @ApiProperty({ format: 'date' }) issueDate!: string;
  @ApiProperty({ format: 'date' }) dueDate!: string;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional({ type: [InvoiceLineDto] }) lines!: InvoiceLineDto[];
  @ApiProperty() subtotal!: string;
  @ApiPropertyOptional() vatRate!: string;
  @ApiProperty() vatAmount!: string;
  @ApiProperty() total!: string;
  @ApiPropertyOptional() amountPaid!: string;
  @ApiProperty() balance!: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) paidAt!: string | null;
  @ApiPropertyOptional({ format: 'uuid' }) tenantId?: string;
}

export class BillingInvoicePage {
  @ApiProperty({ type: [BillingInvoiceDto] }) data!: BillingInvoiceDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

// components.schemas.BillingPayment
export class BillingPaymentDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) invoiceId!: string;
  @ApiPropertyOptional() invoiceNumber?: string;
  @ApiPropertyOptional({ format: 'uuid' }) tenantId?: string;
  @ApiPropertyOptional() tenantName?: string;
  @ApiProperty({ enum: ['card', 'bank_transfer'] }) method!: string;
  @ApiProperty({ enum: ['pending', 'succeeded', 'failed', 'refunded'] }) status!: string;
  @ApiProperty() amount!: string;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) bankReference!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) proofFileId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) failureReason!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) receivedAt!: string | null;
  @ApiProperty({ format: 'date-time', readOnly: true }) createdAt!: string;
}

export class BillingPaymentPage {
  @ApiProperty({ type: [BillingPaymentDto] }) data!: BillingPaymentDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

// components.schemas.BillingUsage
export class BillingUsageDto {
  @ApiProperty() seats!: number;
  @ApiProperty() seatsUsed!: number;
  @ApiPropertyOptional() invitedUsers!: number;
  @ApiPropertyOptional() leadsThisMonth!: number;
  @ApiPropertyOptional() messagesThisMonth!: number;
  @ApiPropertyOptional() storageBytes!: number;
}

// components.schemas.SubscriptionEvent
export class SubscriptionEventDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() type!: string;
  @ApiPropertyOptional({ type: Object, nullable: true }) oldValue!: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: Object, nullable: true }) newValue!: Record<string, unknown> | null;
  @ApiProperty({ enum: ['user', 'platform_admin', 'system', 'stripe'] }) actorType!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) actorName!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class SubscriptionEventPage {
  @ApiProperty({ type: [SubscriptionEventDto] }) data!: SubscriptionEventDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

// ---------------------------------------------------------------- requests
export class ChangePlanDto {
  @ApiProperty({ format: 'uuid' }) @IsUuid() planId!: string;
  @ApiPropertyOptional({ enum: ['monthly', 'yearly'] }) @IsOptional() @IsIn(['monthly', 'yearly']) billingCycle?: 'monthly' | 'yearly';
}

export class SeatsDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(100_000) seats!: number;
}

export class PaymentMethodDto {
  @ApiProperty({ enum: ['card', 'bank_transfer'] }) @IsIn(['card', 'bank_transfer']) method!: 'card' | 'bank_transfer';
}

export class CancelDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class BankTransferDto {
  @ApiProperty() @Matches(MONEY, { message: 'amount must be a positive decimal with up to 2 places' }) amount!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(100) bankReference!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() proofFileId?: string;
}

// components.schemas.SignupStart
export class SignupStartDto {
  @ApiProperty({ enum: ['brokerage', 'individual'] }) @IsIn(['brokerage', 'individual']) tenantType!: 'brokerage' | 'individual';
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) companyName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) tradeLicenseNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) reraOrn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) reraBrn?: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) adminFullName!: string;
  @ApiProperty({ format: 'email' }) @Transform(lowerTrim) @IsEmail() adminEmail!: string;
  @ApiProperty({ pattern: E164.source }) @Matches(E164, { message: 'adminPhone must be in E.164 format' }) adminPhone!: string;
  @ApiProperty() @IsString() @MaxLength(50) planKey!: string;
  @ApiPropertyOptional({ minimum: 1 }) @IsOptional() @IsInt() @Min(1) @Max(10_000) seats?: number;
  @ApiProperty({ enum: ['monthly', 'yearly'] }) @IsIn(['monthly', 'yearly']) billingCycle!: 'monthly' | 'yearly';
  @ApiProperty() @IsBoolean() @Equals(true, { message: 'the terms must be accepted' }) acceptTerms!: boolean;
  @ApiProperty() @IsString() @MaxLength(4096) turnstileToken!: string;
}

export class SignupDto {
  @ApiProperty({ format: 'uuid' }) signupId!: string;
  @ApiProperty() emailVerified!: boolean;
  @ApiProperty({ type: CardSetupDto }) cardSetup!: CardSetupDto;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

export class VerifyCodeDto {
  @ApiProperty({ pattern: '^[0-9]{6}$' }) @Matches(/^[0-9]{6}$/, { message: 'code must be 6 digits' }) code!: string;
}

export class CompleteSignupDto {
  @ApiProperty() @IsString() @MaxLength(255) setupIntentId!: string;
}

export class SignupCompleteDto {
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ format: 'date-time' }) trialEndsAt!: string;
  @ApiProperty() loginUrl!: string;
}

// components.schemas.SalesEnquiry
export class SalesEnquiryInputDto {
  @IsOptional() id?: unknown;
  @IsOptional() status?: unknown;
  @IsOptional() createdAt?: unknown;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) companyName!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) contactName!: string;
  @ApiProperty({ format: 'email' }) @Transform(lowerTrim) @IsEmail() email!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(E164, { message: 'phone must be in E.164 format' }) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100_000) usersEstimate?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) message?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4096) turnstileToken?: string;
}

export class SalesEnquiryDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() companyName!: string;
  @ApiProperty() contactName!: string;
  @ApiProperty() email!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) phone!: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) usersEstimate!: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) message!: string | null;
  @ApiProperty({ enum: ['new', 'contacted', 'won', 'lost'], readOnly: true }) status!: string;
  @ApiProperty({ format: 'date-time', readOnly: true }) createdAt!: string;
}
