import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { DownloadLink } from '../../core/files/download-link';
import { FilesService } from '../../core/files/files.service';
import { parseIfMatch, toEtag } from '../../core/http/etag';
import { AttachFileDto, AttachmentDto, AttachmentList } from '../leads/dto/lead.dto';
import { CommissionsService } from './commissions.service';
import { CounterpartiesService } from './counterparties.service';
import { DocumentsService } from './documents.service';
import {
  CancelRequestDto,
  CommissionDto,
  CommissionInputDto,
  CommissionListQuery,
  CommissionPage,
  CounterpartyDto,
  CounterpartyInputDto,
  CounterpartyListQuery,
  CounterpartyPage,
  DocumentEventList,
  FinanceDocumentDto,
  FinanceDocumentInputDto,
  FinanceDocumentListQuery,
  FinanceDocumentPage,
  MarkPaidDto,
  PaymentInputDto,
  PaymentList,
  SendDocumentDto,
} from './dto/finance.dto';

const attachment = (a: { id: string; fileId: string; fileName: string; category: string; createdAt: Date }): AttachmentDto => ({
  id: a.id,
  fileId: a.fileId,
  fileName: a.fileName,
  category: a.category,
  createdAt: a.createdAt.toISOString(),
});

@ApiTags('Finance')
@ApiBearerAuth('bearer')
@Controller()
export class FinanceController {
  constructor(
    private readonly counterparties: CounterpartiesService,
    private readonly documents: DocumentsService,
    private readonly commissions: CommissionsService,
    private readonly files: FilesService,
  ) {}

  // ---------------------------------------------------------------- counterparties
  @Get('counterparties')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'listCounterparties', summary: 'List clients, developers and vendors' })
  @ApiOkResponse({ type: CounterpartyPage })
  listCounterparties(@Query() q: CounterpartyListQuery): Promise<CounterpartyPage> {
    return this.counterparties.list(q);
  }

  @Post('counterparties')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'createCounterparty', summary: 'Add a client, developer or vendor' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: CounterpartyDto })
  async createCounterparty(@Body() body: CounterpartyInputDto, @Res({ passthrough: true }) res: Response): Promise<CounterpartyDto> {
    const row = await this.counterparties.create(body);
    res.setHeader('ETag', toEtag(row.updatedAt));
    return CounterpartyDto.from(row);
  }

  @Get('counterparties/:id')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'getCounterparty', summary: 'Get a counterparty' })
  @ApiOkResponse({ type: CounterpartyDto })
  async getCounterparty(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<CounterpartyDto> {
    const row = await this.counterparties.get(id);
    res.setHeader('ETag', toEtag(row.updatedAt));
    return CounterpartyDto.from(row);
  }

  @Patch('counterparties/:id')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'updateCounterparty', summary: 'Update a counterparty' })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiOkResponse({ type: CounterpartyDto })
  async updateCounterparty(@Param('id', ParseUUIDPipe) id: string, @Body() body: CounterpartyInputDto, @Headers('if-match') ifMatch: string | undefined, @Res({ passthrough: true }) res: Response): Promise<CounterpartyDto> {
    const row = await this.counterparties.update(id, body, parseIfMatch(ifMatch));
    res.setHeader('ETag', toEtag(row.updatedAt));
    return CounterpartyDto.from(row);
  }

  // ---------------------------------------------------------------- documents
  @Get('finance-documents')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'listFinancialDocuments', summary: 'List invoices and purchase orders' })
  @ApiOkResponse({ type: FinanceDocumentPage })
  listDocuments(@Query() q: FinanceDocumentListQuery): Promise<FinanceDocumentPage> {
    return this.documents.list(q);
  }

  @Post('finance-documents')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'createFinancialDocument', summary: 'Create a draft invoice or purchase order' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: FinanceDocumentDto })
  async createDocument(@CurrentPrincipal() p: Principal, @Body() body: FinanceDocumentInputDto, @Res({ passthrough: true }) res: Response): Promise<FinanceDocumentDto> {
    const row = await this.documents.create(p, body);
    res.setHeader('ETag', toEtag(row.version));
    return this.documents.dto(row);
  }

  @Get('finance-documents/:id')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'getFinancialDocument', summary: 'Get a document' })
  @ApiOkResponse({ type: FinanceDocumentDto })
  async getDocument(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<FinanceDocumentDto> {
    const row = await this.documents.get(id);
    res.setHeader('ETag', toEtag(row.version));
    return this.documents.dto(row);
  }

  @Patch('finance-documents/:id')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'updateDraftDocument', summary: 'Edit a draft' })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiOkResponse({ type: FinanceDocumentDto })
  async updateDocument(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: FinanceDocumentInputDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FinanceDocumentDto> {
    const row = await this.documents.update(p, id, body, parseIfMatch(ifMatch));
    res.setHeader('ETag', toEtag(row.version));
    return this.documents.dto(row);
  }

  @Post('finance-documents/:id/approve')
  @HttpCode(200)
  @RequirePermission('finance.approve')
  @ApiOperation({ operationId: 'approveDocument', summary: 'Approve: number, PDF, amounts locked' })
  @ApiOkResponse({ type: FinanceDocumentDto })
  async approve(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<FinanceDocumentDto> {
    return this.documents.dto(await this.documents.approve(p, id));
  }

  @Post('finance-documents/:id/send')
  @HttpCode(200)
  @RequirePermission('finance.approve')
  @ApiOperation({ operationId: 'sendDocument', summary: 'Email the document' })
  @ApiOkResponse({ type: FinanceDocumentDto })
  async send(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: SendDocumentDto): Promise<FinanceDocumentDto> {
    return this.documents.dto(await this.documents.send(p, id, body));
  }

  @Post('finance-documents/:id/cancel')
  @HttpCode(200)
  @RequirePermission('finance.approve')
  @ApiOperation({ operationId: 'cancelDocument', summary: 'Cancel an approved document' })
  @ApiOkResponse({ type: FinanceDocumentDto })
  async cancel(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: CancelRequestDto): Promise<FinanceDocumentDto> {
    return this.documents.dto(await this.documents.cancel(p, id, body.reason));
  }

  @Get('finance-documents/:id/pdf')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'downloadDocumentPdf', summary: 'PDF download link' })
  @ApiOkResponse({ type: DownloadLink })
  pdf(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<DownloadLink> {
    return this.documents.pdfLink(p, id);
  }

  @Get('finance-documents/:id/history')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'getDocumentHistory', summary: 'Approval and status history' })
  @ApiOkResponse({ type: DocumentEventList })
  async history(@Param('id', ParseUUIDPipe) id: string): Promise<DocumentEventList> {
    return { data: await this.documents.history(id) };
  }

  @Get('finance-documents/:id/payments')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'listPayments', summary: 'Payments and refunds' })
  @ApiOkResponse({ type: PaymentList })
  async payments(@Param('id', ParseUUIDPipe) id: string): Promise<PaymentList> {
    return { data: await this.documents.listPayments(id) };
  }

  @Post('finance-documents/:id/payments')
  @RequirePermission('finance.approve')
  @ApiOperation({ operationId: 'recordPaymentOrRefund', summary: 'Record a payment or refund' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: FinanceDocumentDto })
  async recordPayment(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: PaymentInputDto): Promise<FinanceDocumentDto> {
    return this.documents.dto(await this.documents.recordPayment(p, id, body));
  }

  @Get('finance-documents/:id/attachments')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'listFinanceDocumentAttachments', summary: 'Files of a document' })
  @ApiOkResponse({ type: AttachmentList })
  async documentFiles(@Param('id', ParseUUIDPipe) id: string): Promise<AttachmentList> {
    await this.documents.get(id);
    return { data: (await this.files.listAttachments({ type: 'finance_document', id })).map(attachment) };
  }

  @Post('finance-documents/:id/attachments')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'attachFileToFinanceDocument', summary: 'Attach a file to a document' })
  @ApiCreatedResponse({ type: AttachmentDto })
  async attachToDocument(@Param('id', ParseUUIDPipe) id: string, @Body() body: AttachFileDto): Promise<AttachmentDto> {
    await this.documents.get(id);
    return attachment(await this.files.attach({ type: 'finance_document', id }, body.fileId, body.category));
  }

  // ---------------------------------------------------------------- commissions
  @Get('commissions')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'listCommissions', summary: 'List commissions' })
  @ApiOkResponse({ type: CommissionPage })
  listCommissions(@Query() q: CommissionListQuery): Promise<CommissionPage> {
    return this.commissions.list(q);
  }

  @Post('commissions')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'createCommission', summary: 'Add an agent commission' })
  @ApiCreatedResponse({ type: CommissionDto })
  async createCommission(@Body() body: CommissionInputDto): Promise<CommissionDto> {
    return CommissionDto.from(await this.commissions.create(body));
  }

  @Post('commissions/:id/approve')
  @HttpCode(200)
  @RequirePermission('finance.approve')
  @ApiOperation({ operationId: 'approveCommission', summary: 'Approve a commission' })
  @ApiOkResponse({ type: CommissionDto })
  async approveCommission(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<CommissionDto> {
    return CommissionDto.from(await this.commissions.approve(p, id));
  }

  @Post('commissions/:id/mark-paid')
  @HttpCode(200)
  @RequirePermission('finance.approve')
  @ApiOperation({ operationId: 'markCommissionPaid', summary: 'Mark a commission paid' })
  @ApiOkResponse({ type: CommissionDto })
  async markPaid(@Param('id', ParseUUIDPipe) id: string, @Body() body: MarkPaidDto): Promise<CommissionDto> {
    return CommissionDto.from(await this.commissions.markPaid(id, body.paidOn));
  }

  @Get('commissions/:id/attachments')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'listCommissionAttachments', summary: 'Files of a commission' })
  @ApiOkResponse({ type: AttachmentList })
  async commissionFiles(@Param('id', ParseUUIDPipe) id: string): Promise<AttachmentList> {
    await this.commissions.get(id);
    return { data: (await this.files.listAttachments({ type: 'commission', id })).map(attachment) };
  }

  @Post('commissions/:id/attachments')
  @RequirePermission('finance.create')
  @ApiOperation({ operationId: 'attachFileToCommission', summary: 'Attach a file to a commission' })
  @ApiCreatedResponse({ type: AttachmentDto })
  async attachToCommission(@Param('id', ParseUUIDPipe) id: string, @Body() body: AttachFileDto): Promise<AttachmentDto> {
    await this.commissions.get(id);
    return attachment(await this.files.attach({ type: 'commission', id }, body.fileId, body.category));
  }
}
