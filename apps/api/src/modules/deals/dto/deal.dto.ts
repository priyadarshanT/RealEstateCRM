import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PageInfo, PageQuery } from '../../../core/http/pagination';
import { IsDateOnly, IsUuid } from '../../../core/http/validators';
import { DEAL_STAGES, DealRow, DealStage } from '../deals.schema';

const MONEY = /^\d+(\.\d{1,2})?$/;
const nullableMoney = { type: String, nullable: true, example: '3250000.00' } as const;
const nullableDate = { type: String, format: 'date', nullable: true } as const;
const money = (v: string | null) => (v === null ? null : Number(v).toFixed(2));

// components.schemas.Deal
export class DealDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) leadId!: string;
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) unitId!: string | null;
  @ApiProperty({ format: 'uuid' }) ownerUserId!: string;
  @ApiProperty({ enum: DEAL_STAGES, readOnly: true }) stage!: DealStage;
  @ApiProperty({ example: 'AED' }) currency!: string;
  @ApiPropertyOptional(nullableMoney) offerPrice!: string | null;
  @ApiPropertyOptional(nullableDate) offerDate!: string | null;
  @ApiPropertyOptional(nullableMoney) eoiAmount!: string | null;
  @ApiPropertyOptional(nullableDate) eoiDate!: string | null;
  @ApiPropertyOptional(nullableMoney) bookingAmount!: string | null;
  @ApiPropertyOptional(nullableDate) bookingDate!: string | null;
  @ApiPropertyOptional(nullableMoney) saleValue!: string | null;
  @ApiPropertyOptional(nullableDate) saleDate!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) cancelledReason!: string | null;

  static from(d: DealRow): DealDto {
    return {
      id: d.id,
      leadId: d.leadId,
      projectId: d.projectId,
      unitId: d.unitId,
      ownerUserId: d.ownerUserId,
      stage: d.stage,
      currency: d.currency,
      offerPrice: money(d.offerPrice),
      offerDate: d.offerDate,
      eoiAmount: money(d.eoiAmount),
      eoiDate: d.eoiDate,
      bookingAmount: money(d.bookingAmount),
      bookingDate: d.bookingDate,
      saleValue: money(d.saleValue),
      saleDate: d.saleDate,
      cancelledReason: d.cancelledReason,
    };
  }
}

export class DealPage {
  @ApiProperty({ type: [DealDto] }) data!: DealDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class DealListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() leadId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() projectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(DEAL_STAGES) stage?: DealStage;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() ownerUserId?: string;
}

/** POST /deals and PATCH /deals/{id}. Stage and the stage amounts change through POST /deals/{id}/stage. */
export class DealInputDto {
  @IsOptional() id?: unknown;
  @IsOptional() stage?: unknown;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() leadId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() projectId?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() unitId?: string | null;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() ownerUserId?: string;
  @ApiPropertyOptional({ example: 'AED' }) @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional(nullableMoney) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(MONEY) offerPrice?: string | null;
  @ApiPropertyOptional(nullableDate) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateOnly() offerDate?: string | null;
  @ApiPropertyOptional(nullableMoney) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(MONEY) eoiAmount?: string | null;
  @ApiPropertyOptional(nullableDate) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateOnly() eoiDate?: string | null;
  @ApiPropertyOptional(nullableMoney) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(MONEY) bookingAmount?: string | null;
  @ApiPropertyOptional(nullableDate) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateOnly() bookingDate?: string | null;
  @ApiPropertyOptional(nullableMoney) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(MONEY) saleValue?: string | null;
  @ApiPropertyOptional(nullableDate) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateOnly() saleDate?: string | null;
  @IsOptional() cancelledReason?: unknown;
}

/** components.schemas.DealStageChange: 409 UNIT_ALREADY_BOOKED when another deal holds the unit. */
export class DealStageChangeDto {
  @ApiProperty({ enum: ['eoi', 'booking', 'sold', 'cancelled'] }) @IsIn(['eoi', 'booking', 'sold', 'cancelled']) stage!: Exclude<DealStage, 'offer'>;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() unitId?: string;
  @ApiPropertyOptional({ example: '3250000.00' }) @IsOptional() @Matches(MONEY) amount?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(500) cancelledReason?: string;
}
