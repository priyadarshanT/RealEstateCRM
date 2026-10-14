import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageInfo, PageQuery } from '../../../core/http/pagination';
import { IsDateOnly, IsUuid } from '../../../core/http/validators';
import {
  COMMISSION_STATUSES,
  CommissionRow,
  COUNTERPARTY_TYPES,
  CounterpartyRow,
  DOC_STATUSES,
  DOC_TYPES,
  DocStatus,
  DocType,
  DocumentEventRow,
  DocumentLineRow,
  FinanceDocumentRow,
  PAYMENT_METHODS,
  PaymentRow,
} from '../finance.schema';

const MONEY = /^\d+(\.\d{1,2})?$/;
const nullableString = { type: String, nullable: true } as const;
const nullableUuid = { type: String, format: 'uuid', nullable: true } as const;
const nullableDate = { type: String, format: 'date', nullable: true } as const;
export const money = (v: string | null) => (v === null ? null : Number(v).toFixed(2));

// ---------------------------------------------------------------- counterparties
export class CounterpartyDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ enum: COUNTERPARTY_TYPES }) type!: CounterpartyRow['type'];
  @ApiProperty() name!: string;
  @ApiPropertyOptional(nullableString) trn!: string | null;
  @ApiPropertyOptional(nullableString) email!: string | null;
  @ApiPropertyOptional(nullableString) phone!: string | null;
  @ApiPropertyOptional(nullableString) address!: string | null;
  @ApiPropertyOptional(nullableUuid) leadId!: string | null;
  @ApiPropertyOptional(nullableUuid) developerId!: string | null;

  static from(c: CounterpartyRow): CounterpartyDto {
    return { id: c.id, type: c.type, name: c.name, trn: c.trn, email: c.email, phone: c.phone, address: c.address, leadId: c.leadId, developerId: c.developerId };
  }
}

export class CounterpartyPage {
  @ApiProperty({ type: [CounterpartyDto] }) data!: CounterpartyDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class CounterpartyListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: COUNTERPARTY_TYPES }) @IsOptional() @IsIn(COUNTERPARTY_TYPES) type?: CounterpartyRow['type'];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) q?: string;
}

export class CounterpartyInputDto {
  @IsOptional() id?: unknown;
  @ApiPropertyOptional({ enum: COUNTERPARTY_TYPES }) @IsOptional() @IsIn(COUNTERPARTY_TYPES) type?: CounterpartyRow['type'];
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(50) trn?: string | null;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) email?: string | null;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(30) phone?: string | null;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) address?: string | null;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() leadId?: string | null;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() developerId?: string | null;
}

// ---------------------------------------------------------------- documents (components.schemas.FinanceDocument)
export class DocumentLineDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(500) lineNo!: number;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) description!: string;
  @ApiProperty({ example: '1.000' }) @Matches(/^\d{1,9}(\.\d{1,3})?$/) quantity!: string;
  @ApiProperty({ example: '3250000.00' }) @Matches(MONEY) unitPrice!: string;
  @ApiProperty({ example: '5.00' }) @Matches(/^\d{1,3}(\.\d{1,2})?$/) taxRate!: string;
  @ApiPropertyOptional({ readOnly: true, example: '3250000.00' }) @IsOptional() lineSubtotal?: string;
  @ApiPropertyOptional({ readOnly: true, example: '3250000.00' }) @IsOptional() taxAmount?: string;

  static from(l: DocumentLineRow): DocumentLineDto {
    return {
      lineNo: l.lineNo,
      description: l.description,
      quantity: Number(l.quantity).toFixed(3),
      unitPrice: money(l.unitPrice)!,
      taxRate: Number(l.taxRate).toFixed(2),
      lineSubtotal: money(l.lineSubtotal)!,
      taxAmount: money(l.taxAmount)!,
    };
  }
}

export class FinanceDocumentDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ enum: DOC_TYPES }) docType!: DocType;
  @ApiPropertyOptional({ type: String, nullable: true, readOnly: true }) number!: string | null;
  @ApiProperty({ format: 'uuid' }) counterpartyId!: string;
  @ApiPropertyOptional(nullableUuid) leadId!: string | null;
  @ApiPropertyOptional(nullableUuid) projectId!: string | null;
  @ApiPropertyOptional(nullableUuid) unitId!: string | null;
  @ApiPropertyOptional(nullableUuid) dealId!: string | null;
  @ApiPropertyOptional(nullableUuid) purchaseOrderId!: string | null;
  @ApiProperty({ format: 'date' }) issueDate!: string;
  @ApiPropertyOptional(nullableDate) dueDate!: string | null;
  @ApiProperty({ example: 'AED' }) currency!: string;
  @ApiPropertyOptional() rateToBase!: string;
  @ApiProperty({ type: [DocumentLineDto] }) lines!: DocumentLineDto[];
  @ApiPropertyOptional({ readOnly: true }) subtotal!: string;
  @ApiPropertyOptional({ readOnly: true }) taxTotal!: string;
  @ApiPropertyOptional({ readOnly: true }) total!: string;
  @ApiPropertyOptional({ readOnly: true }) amountPaid!: string;
  @ApiPropertyOptional({ readOnly: true }) amountRefunded!: string;
  @ApiPropertyOptional({ readOnly: true }) balance!: string;
  @ApiPropertyOptional(nullableString) paymentTerms!: string | null;
  @ApiPropertyOptional(nullableString) notes!: string | null;
  @ApiProperty({ enum: DOC_STATUSES, readOnly: true }) status!: DocStatus;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, readOnly: true }) pdfFileId!: string | null;
  @ApiProperty() version!: number;

  static from(d: FinanceDocumentRow, lines: DocumentLineRow[]): FinanceDocumentDto {
    return {
      id: d.id,
      docType: d.docType,
      number: d.number,
      counterpartyId: d.counterpartyId,
      leadId: d.leadId,
      projectId: d.projectId,
      unitId: d.unitId,
      dealId: d.dealId,
      purchaseOrderId: d.purchaseOrderId,
      issueDate: d.issueDate,
      dueDate: d.dueDate,
      currency: d.currency,
      rateToBase: Number(d.rateToBase).toString(),
      lines: lines.map(DocumentLineDto.from),
      subtotal: money(d.subtotal)!,
      taxTotal: money(d.taxTotal)!,
      total: money(d.total)!,
      amountPaid: money(d.amountPaid)!,
      amountRefunded: money(d.amountRefunded)!,
      balance: money(d.balance)!,
      paymentTerms: d.paymentTerms,
      notes: d.notes,
      status: d.status,
      pdfFileId: d.pdfFileId,
      version: d.version,
    };
  }
}

export class FinanceDocumentPage {
  @ApiProperty({ type: [FinanceDocumentDto] }) data!: FinanceDocumentDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class FinanceDocumentListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: DOC_TYPES }) @IsOptional() @IsIn(DOC_TYPES) docType?: DocType;
  @ApiPropertyOptional({ enum: DOC_STATUSES }) @IsOptional() @IsIn(DOC_STATUSES) status?: DocStatus;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() counterpartyId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() leadId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() dealId?: string;
  @ApiPropertyOptional({ format: 'date', description: 'Issue date from' }) @IsOptional() @IsDateOnly() from?: string;
  @ApiPropertyOptional({ format: 'date', description: 'Issue date to (inclusive)' }) @IsOptional() @IsDateOnly() to?: string;
}

export class FinanceDocumentInputDto {
  @IsOptional() id?: unknown;
  @IsOptional() number?: unknown;
  @IsOptional() status?: unknown;
  @IsOptional() pdfFileId?: unknown;
  @IsOptional() subtotal?: unknown;
  @IsOptional() taxTotal?: unknown;
  @IsOptional() total?: unknown;
  @IsOptional() amountPaid?: unknown;
  @IsOptional() amountRefunded?: unknown;
  @IsOptional() balance?: unknown;
  @IsOptional() version?: unknown;
  @ApiPropertyOptional({ enum: DOC_TYPES }) @IsOptional() @IsIn(DOC_TYPES) docType?: DocType;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() counterpartyId?: string;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() leadId?: string | null;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() projectId?: string | null;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() unitId?: string | null;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() dealId?: string | null;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() purchaseOrderId?: string | null;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() issueDate?: string;
  @ApiPropertyOptional(nullableDate) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateOnly() dueDate?: string | null;
  @ApiPropertyOptional({ example: 'AED' }) @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{1,10}(\.\d{1,8})?$/) rateToBase?: string;
  @ApiPropertyOptional({ type: [DocumentLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DocumentLineDto)
  lines?: DocumentLineDto[];
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) paymentTerms?: string | null;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000) notes?: string | null;
}

export class SendDocumentDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsEmail({}, { each: true }) to?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) message?: string;
}

export class CancelRequestDto {
  @ApiProperty({ minLength: 3 }) @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class DocumentEventDto {
  @ApiProperty() action!: string;
  @ApiPropertyOptional(nullableString) fromStatus!: string | null;
  @ApiPropertyOptional(nullableString) toStatus!: string | null;
  @ApiPropertyOptional(nullableUuid) actorUserId!: string | null;
  @ApiPropertyOptional(nullableString) note!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;

  static from(e: DocumentEventRow): DocumentEventDto {
    return { action: e.action, fromStatus: e.fromStatus, toStatus: e.toStatus, actorUserId: e.actorUserId, note: e.note, createdAt: e.createdAt.toISOString() };
  }
}

export class DocumentEventList {
  @ApiProperty({ type: [DocumentEventDto] }) data!: DocumentEventDto[];
}

// ---------------------------------------------------------------- payments (components.schemas.Payment)
export class PaymentDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ enum: ['payment', 'refund'] }) kind!: 'payment' | 'refund';
  @ApiProperty({ example: '3250000.00' }) amount!: string;
  @ApiProperty({ example: 'AED' }) currency!: string;
  @ApiProperty({ format: 'date' }) paidOn!: string;
  @ApiProperty({ enum: PAYMENT_METHODS }) method!: PaymentRow['method'];
  @ApiPropertyOptional(nullableString) reference!: string | null;
  @ApiPropertyOptional(nullableString) notes!: string | null;
  @ApiPropertyOptional(nullableUuid) proofFileId!: string | null;

  static from(p: PaymentRow): PaymentDto {
    return { id: p.id, kind: p.kind, amount: money(p.amount)!, currency: p.currency, paidOn: p.paidOn, method: p.method, reference: p.reference, notes: p.notes, proofFileId: p.proofFileId };
  }
}

export class PaymentList {
  @ApiProperty({ type: [PaymentDto] }) data!: PaymentDto[];
}

export class PaymentInputDto {
  @IsOptional() id?: unknown;
  @ApiProperty({ enum: ['payment', 'refund'] }) @IsIn(['payment', 'refund']) kind!: 'payment' | 'refund';
  @ApiProperty({ example: '3250000.00' }) @Matches(MONEY) amount!: string;
  @ApiProperty({ example: 'AED' }) @Matches(/^[A-Z]{3}$/) currency!: string;
  @ApiProperty({ format: 'date' }) @IsDateOnly() paidOn!: string;
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) method!: PaymentRow['method'];
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) reference?: string | null;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) notes?: string | null;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() proofFileId?: string | null;
}

// ---------------------------------------------------------------- commissions (components.schemas.Commission)
export class CommissionDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) dealId!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ enum: ['percentage', 'fixed'] }) basis!: 'percentage' | 'fixed';
  @ApiPropertyOptional(nullableString) rate!: string | null;
  @ApiProperty({ example: '3250000.00' }) amount!: string;
  @ApiProperty({ example: 'AED' }) currency!: string;
  @ApiProperty({ enum: COMMISSION_STATUSES, readOnly: true }) status!: CommissionRow['status'];
  @ApiPropertyOptional(nullableUuid) developerInvoiceId!: string | null;
  @ApiPropertyOptional(nullableDate) paidOn!: string | null;
  @ApiPropertyOptional(nullableString) notes!: string | null;

  static from(c: CommissionRow): CommissionDto {
    return {
      id: c.id,
      dealId: c.dealId,
      userId: c.userId,
      basis: c.basis,
      rate: c.rate === null ? null : Number(c.rate).toString(),
      amount: money(c.amount)!,
      currency: c.currency,
      status: c.status,
      developerInvoiceId: c.developerInvoiceId,
      paidOn: c.paidOn,
      notes: c.notes,
    };
  }
}

export class CommissionPage {
  @ApiProperty({ type: [CommissionDto] }) data!: CommissionDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class CommissionListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() userId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() dealId?: string;
  @ApiPropertyOptional({ enum: COMMISSION_STATUSES }) @IsOptional() @IsIn(COMMISSION_STATUSES) status?: CommissionRow['status'];
}

export class CommissionInputDto {
  @IsOptional() id?: unknown;
  @IsOptional() status?: unknown;
  @IsOptional() paidOn?: unknown;
  @ApiProperty({ format: 'uuid' }) @IsUuid() dealId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUuid() userId!: string;
  @ApiProperty({ enum: ['percentage', 'fixed'] }) @IsIn(['percentage', 'fixed']) basis!: 'percentage' | 'fixed';
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^\d{1,3}(\.\d{1,3})?$/) rate?: string | null;
  @ApiPropertyOptional({ example: '3250000.00' }) @IsOptional() @Matches(MONEY) amount?: string;
  @ApiPropertyOptional({ example: 'AED' }) @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() developerInvoiceId?: string | null;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) notes?: string | null;
}

export class MarkPaidDto {
  @ApiProperty({ format: 'date' }) @IsDateOnly() paidOn!: string;
}
