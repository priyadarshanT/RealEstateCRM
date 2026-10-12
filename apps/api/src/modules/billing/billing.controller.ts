import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional } from 'class-validator';
import { AllowWhenReadOnly, CurrentPrincipal, Public, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { DownloadLink } from '../../core/files/download-link';
import { PageQuery } from '../../core/http/pagination';
import { ExportDto } from '../reports/reports.service';
import { ReportsService } from '../reports/reports.service';
import { BillingCoreService } from './billing-core.service';
import { BillingService } from './billing.service';
import {
  BankTransferDto,
  BillingInvoiceDto,
  BillingInvoicePage,
  BillingPaymentDto,
  BillingPaymentPage,
  BillingUsageDto,
  CancelDto,
  CardSetupDto,
  ChangePlanDto,
  CompleteSignupDto,
  PaymentMethodDto,
  PlanList,
  SalesEnquiryInputDto,
  SeatsDto,
  SignupCompleteDto,
  SignupDto,
  SignupStartDto,
  SubscriptionDto,
  SubscriptionEventPage,
  VerifyCodeDto,
} from './dto/billing.dto';
import { SignupService } from './signup.service';

class Received {
  @ApiProperty() received!: boolean;
}

class InvoiceQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['open', 'paid', 'void', 'uncollectible'] }) @IsOptional() @IsIn(['open', 'paid', 'void', 'uncollectible']) status?: string;
}

/** Pricing page, sign-up and "talk to sales" (no login; 10 requests a minute per IP plus the bot check, API guide §10). */
@ApiTags('Public sign-up')
@Controller('public')
@Public()
@Throttle({ user: { limit: 10, ttl: 60_000 } })
export class PublicSignupController {
  constructor(
    private readonly signup: SignupService,
    private readonly core: BillingCoreService,
  ) {}

  @Get('plans')
  @Throttle({ user: { limit: 600, ttl: 60_000 } })
  @ApiOperation({ operationId: 'listPlansForPricingPage', summary: 'Plans and prices' })
  @ApiOkResponse({ type: PlanList })
  async plans(): Promise<PlanList> {
    return { data: (await this.core.activePlans()).map(BillingCoreService.planDto) };
  }

  @Post('signup')
  @ApiOperation({ operationId: 'startSignUp', summary: 'Start sign-up' })
  @ApiCreatedResponse({ type: SignupDto })
  start(@Body() body: SignupStartDto, @Ip() ip: string): Promise<SignupDto> {
    return this.signup.start(body, ip);
  }

  @Post('signup/:id/verify-email')
  @HttpCode(200)
  @ApiOperation({ operationId: 'verifySignUpEmail', summary: 'Confirm the email code' })
  @ApiOkResponse({ type: SignupDto })
  verify(@Param('id', ParseUUIDPipe) id: string, @Body() body: VerifyCodeDto): Promise<SignupDto> {
    return this.signup.verifyEmail(id, body.code);
  }

  @Post('signup/:id/resend-code')
  @HttpCode(204)
  @ApiOperation({ operationId: 'resendSignUpCode', summary: 'Send a new code' })
  @ApiNoContentResponse({ description: 'Done' })
  resend(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.signup.resendCode(id);
  }

  @Post('signup/:id/complete')
  @ApiOperation({ operationId: 'completeSignUpAndStartTrial', summary: 'Card saved: create the company and start the trial' })
  @ApiCreatedResponse({ type: SignupCompleteDto })
  complete(@Param('id', ParseUUIDPipe) id: string, @Body() body: CompleteSignupDto): Promise<SignupCompleteDto> {
    return this.signup.complete(id, body);
  }

  @Post('sales-enquiries')
  @ApiOperation({ operationId: 'contactSales', summary: 'Talk to sales' })
  @ApiCreatedResponse({ type: Received })
  async contactSales(@Body() body: SalesEnquiryInputDto, @Ip() ip: string): Promise<Received> {
    await this.signup.contactSales(body, ip);
    return { received: true };
  }
}

/** Organization Profile → Billing (SRS §12). Paying, the card and data export stay possible while read-only. */
@ApiTags('Subscription & billing')
@ApiBearerAuth('bearer')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly reports: ReportsService,
  ) {}

  @Get('subscription')
  @RequirePermission('billing.view')
  @ApiOperation({ operationId: 'getSubscription', summary: 'Plan, seats and status' })
  @ApiOkResponse({ type: SubscriptionDto })
  subscription(@CurrentPrincipal() p: Principal): Promise<SubscriptionDto> {
    return this.billing.subscription(p);
  }

  @Post('subscription/change-plan')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  @AllowWhenReadOnly()
  @ApiOperation({ operationId: 'changePlanOrBillingCycle', summary: 'Change plan or billing cycle' })
  @ApiOkResponse({ type: SubscriptionDto })
  changePlan(@CurrentPrincipal() p: Principal, @Body() body: ChangePlanDto): Promise<SubscriptionDto> {
    return this.billing.changePlan(p, body);
  }

  @Put('subscription/seats')
  @RequirePermission('billing.manage')
  @ApiOperation({ operationId: 'changeNumberOfSeats', summary: 'Change the number of seats' })
  @ApiOkResponse({ type: SubscriptionDto })
  seats(@CurrentPrincipal() p: Principal, @Body() body: SeatsDto): Promise<SubscriptionDto> {
    return this.billing.changeSeats(p, body.seats);
  }

  @Put('subscription/payment-method')
  @RequirePermission('billing.manage')
  @AllowWhenReadOnly()
  @ApiOperation({ operationId: 'changePaymentMethod', summary: 'Card or bank transfer' })
  @ApiOkResponse({ type: SubscriptionDto })
  paymentMethod(@CurrentPrincipal() p: Principal, @Body() body: PaymentMethodDto): Promise<SubscriptionDto> {
    return this.billing.changePaymentMethod(p, body.method);
  }

  @Post('card-setup')
  @RequirePermission('billing.manage')
  @AllowWhenReadOnly()
  @ApiOperation({ operationId: 'startCardUpdate', summary: 'Add or replace the card' })
  @ApiCreatedResponse({ type: CardSetupDto })
  cardSetup(@CurrentPrincipal() p: Principal): Promise<CardSetupDto> {
    return this.billing.cardSetup(p);
  }

  @Post('subscription/cancel')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  @AllowWhenReadOnly()
  @ApiOperation({ operationId: 'cancelSubscription', summary: 'Cancel at the end of the period' })
  @ApiOkResponse({ type: SubscriptionDto })
  cancel(@CurrentPrincipal() p: Principal, @Body() body: CancelDto): Promise<SubscriptionDto> {
    return this.billing.cancel(p, body.reason);
  }

  @Post('subscription/resume')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  @AllowWhenReadOnly()
  @ApiOperation({ operationId: 'undoCancellation', summary: 'Undo the cancellation' })
  @ApiOkResponse({ type: SubscriptionDto })
  resume(@CurrentPrincipal() p: Principal): Promise<SubscriptionDto> {
    return this.billing.resume(p);
  }

  @Get('invoices')
  @RequirePermission('billing.view')
  @ApiOperation({ operationId: 'listSubscriptionInvoices', summary: 'Our tax invoices' })
  @ApiOkResponse({ type: BillingInvoicePage })
  invoices(@Query() query: InvoiceQuery): Promise<BillingInvoicePage> {
    return this.billing.invoices(query.limit, query.cursor, query.status);
  }

  @Get('invoices/:id')
  @RequirePermission('billing.view')
  @ApiOperation({ operationId: 'getSubscriptionInvoice', summary: 'One tax invoice' })
  @ApiOkResponse({ type: BillingInvoiceDto })
  invoice(@Param('id', ParseUUIDPipe) id: string): Promise<BillingInvoiceDto> {
    return this.billing.invoice(id);
  }

  @Get('invoices/:id/pdf')
  @RequirePermission('billing.view')
  @ApiOperation({ operationId: 'downloadInvoicePdf', summary: 'Tax invoice PDF' })
  @ApiOkResponse({ type: DownloadLink })
  pdf(@Param('id', ParseUUIDPipe) id: string): Promise<DownloadLink> {
    return this.billing.invoicePdf(id);
  }

  @Post('invoices/:id/bank-transfers')
  @RequirePermission('billing.manage')
  @AllowWhenReadOnly()
  @ApiOperation({ operationId: 'submitBankTransferDetails', summary: 'Report a bank transfer' })
  @ApiCreatedResponse({ type: BillingPaymentDto })
  bankTransfer(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: BankTransferDto): Promise<BillingPaymentDto> {
    return this.billing.submitBankTransfer(p, id, body);
  }

  @Get('payments')
  @RequirePermission('billing.view')
  @ApiOperation({ operationId: 'listSubscriptionPayments', summary: 'Payments' })
  @ApiOkResponse({ type: BillingPaymentPage })
  payments(@Query() query: PageQuery): Promise<BillingPaymentPage> {
    return this.billing.payments(query.limit, query.cursor);
  }

  @Get('usage')
  @RequirePermission('billing.view')
  @ApiOperation({ operationId: 'getUsage', summary: 'Seats and usage' })
  @ApiOkResponse({ type: BillingUsageDto })
  usage(@CurrentPrincipal() p: Principal): Promise<BillingUsageDto> {
    return this.billing.usage(p);
  }

  @Get('history')
  @RequirePermission('billing.view')
  @ApiOperation({ operationId: 'listSubscriptionHistory', summary: 'Subscription history' })
  @ApiOkResponse({ type: SubscriptionEventPage })
  history(@Query() query: PageQuery): Promise<SubscriptionEventPage> {
    return this.billing.history(query.limit, query.cursor);
  }

  @Post('data-export')
  @HttpCode(202)
  @RequirePermission('billing.manage')
  @AllowWhenReadOnly()
  @ApiOperation({ operationId: 'exportAllCompanyData', summary: 'Export all company data' })
  @ApiAcceptedResponse({ type: ExportDto })
  dataExport(@CurrentPrincipal() p: Principal): Promise<ExportDto> {
    return this.reports.requestCompanyExport(p);
  }
}
