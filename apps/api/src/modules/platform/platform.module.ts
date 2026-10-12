import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsObject } from 'class-validator';
import { Public } from '../../core/auth/decorators';
import { CurrentPlatformAdmin, PlatformAdmin, PlatformAuthGuard, PlatformRoles } from '../../core/auth/platform-auth';
import { PageInfo, PageQuery } from '../../core/http/pagination';
import { AuditEntryDtoDoc } from './platform.docs';
import { BillingModule } from '../billing/billing.module';
import {
  BillingInvoiceDto,
  BillingInvoicePage,
  BillingPaymentDto,
  BillingPaymentPage,
  PlanDto,
  PlanList,
  SalesEnquiryDto,
  SubscriptionDto,
} from '../billing/dto/billing.dto';
import { SettingDto, SettingList } from '../settings/dto/settings.dto';
import { OrganizationModule } from '../organization/organization.module';
import {
  AuditQuery,
  ConfirmTransferDto,
  CreateCompanyDto,
  EnquiryListQuery,
  EnquiryPatchDto,
  ExtendDto,
  InvoiceListQuery,
  PlanInputDto,
  PlatformAdminDto,
  PlatformMetricsDto,
  PlatformTenantDto,
  PlatformTenantPage,
  PlatformReasonDto,
  SubscriptionPatchDto,
  TenantListQuery,
  VerifyDto,
} from './platform.dto';
import { PlatformService } from './platform.service';

class SalesEnquiryPage {
  @ApiProperty({ type: [SalesEnquiryDto] }) data!: SalesEnquiryDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

class PlatformAuditPage {
  @ApiProperty({ type: [AuditEntryDtoDoc] }) data!: AuditEntryDtoDoc[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

class SettingValueDto {
  @ApiProperty({ type: Object }) @IsObject() value!: Record<string, unknown>;
}

/**
 * Owner console (/platform/*): its own login and database role; roles owner, support, billing (API guide §10a).
 * Never a tenant token, so the tenant checks are skipped (Public) and PlatformAuthGuard applies instead.
 */
@ApiTags('Owner console')
@ApiBearerAuth('bearer')
@Controller('platform')
@Public()
@UseGuards(PlatformAuthGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('me')
  @ApiOperation({ operationId: 'getPlatformAdmin', summary: 'Who I am (owner console)' })
  @ApiOkResponse({ type: PlatformAdminDto })
  me(@CurrentPlatformAdmin() admin: PlatformAdmin): PlatformAdminDto {
    return admin;
  }

  @Get('metrics')
  @PlatformRoles('owner', 'support')
  @ApiOperation({ operationId: 'getBusinessMetrics', summary: 'Business metrics' })
  @ApiOkResponse({ type: PlatformMetricsDto })
  metrics(): Promise<PlatformMetricsDto> {
    return this.platform.metrics();
  }

  @Get('tenants')
  @PlatformRoles('owner', 'support')
  @ApiOperation({ operationId: 'listCompanies', summary: 'Companies' })
  @ApiOkResponse({ type: PlatformTenantPage })
  tenants(@Query() query: TenantListQuery): Promise<PlatformTenantPage> {
    return this.platform.tenants(query);
  }

  @Get('tenants/:id')
  @PlatformRoles('owner', 'support')
  @ApiOperation({ operationId: 'getCompany', summary: 'One company' })
  @ApiOkResponse({ type: PlatformTenantDto })
  tenant(@Param('id', ParseUUIDPipe) id: string): Promise<PlatformTenantDto> {
    return this.platform.tenant(id);
  }

  @Post('tenants/:id/verify')
  @HttpCode(200)
  @PlatformRoles('owner', 'support')
  @ApiOperation({ operationId: 'verifyCompanyLicence', summary: 'Licence check' })
  @ApiOkResponse({ type: PlatformTenantDto })
  verify(@CurrentPlatformAdmin() admin: PlatformAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() body: VerifyDto): Promise<PlatformTenantDto> {
    return this.platform.verify(admin, id, body.result, body.note);
  }

  @Post('tenants/:id/suspend')
  @HttpCode(200)
  @PlatformRoles('owner')
  @ApiOperation({ operationId: 'suspendCompany', summary: 'Suspend a company' })
  @ApiOkResponse({ type: PlatformTenantDto })
  suspend(@CurrentPlatformAdmin() admin: PlatformAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() body: PlatformReasonDto): Promise<PlatformTenantDto> {
    return this.platform.suspend(admin, id, body.reason);
  }

  @Post('tenants/:id/unsuspend')
  @HttpCode(200)
  @PlatformRoles('owner')
  @ApiOperation({ operationId: 'unsuspendCompany', summary: 'Lift a suspension' })
  @ApiOkResponse({ type: PlatformTenantDto })
  unsuspend(@CurrentPlatformAdmin() admin: PlatformAdmin, @Param('id', ParseUUIDPipe) id: string): Promise<PlatformTenantDto> {
    return this.platform.unsuspend(admin, id);
  }

  @Post('tenants/:id/extend')
  @HttpCode(200)
  @PlatformRoles('owner')
  @ApiOperation({ operationId: 'extendTrialOrGracePeriod', summary: 'Extend a trial or grace period' })
  @ApiOkResponse({ type: PlatformTenantDto })
  extend(@CurrentPlatformAdmin() admin: PlatformAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() body: ExtendDto): Promise<PlatformTenantDto> {
    return this.platform.extend(admin, id, body.days, body.note);
  }

  @Patch('subscriptions/:id')
  @PlatformRoles('owner')
  @ApiOperation({ operationId: 'setCustomPriceOrSeats', summary: 'Custom price, seats or plan' })
  @ApiOkResponse({ type: SubscriptionDto })
  patchSubscription(@CurrentPlatformAdmin() admin: PlatformAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() body: SubscriptionPatchDto): Promise<SubscriptionDto> {
    return this.platform.patchSubscription(admin, id, body);
  }

  @Post('sales-enquiries/:id/create-company')
  @PlatformRoles('owner')
  @ApiOperation({ operationId: 'createEnterpriseCompany', summary: 'Set up a company sold through sales' })
  @ApiCreatedResponse({ type: PlatformTenantDto })
  createCompany(@CurrentPlatformAdmin() admin: PlatformAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateCompanyDto): Promise<PlatformTenantDto> {
    return this.platform.createCompany(admin, id, body);
  }

  @Get('sales-enquiries')
  @PlatformRoles('owner', 'support')
  @ApiOperation({ operationId: 'listSalesEnquiries', summary: 'Sales enquiries' })
  @ApiOkResponse({ type: SalesEnquiryPage })
  enquiries(@Query() query: EnquiryListQuery): Promise<SalesEnquiryPage> {
    return this.platform.enquiries(query.limit, query.cursor, query.status);
  }

  @Patch('sales-enquiries/:id')
  @PlatformRoles('owner', 'support')
  @ApiOperation({ operationId: 'updateSalesEnquiry', summary: 'Update a sales enquiry' })
  @ApiOkResponse({ type: SalesEnquiryDto })
  updateEnquiry(@CurrentPlatformAdmin() admin: PlatformAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() body: EnquiryPatchDto): Promise<SalesEnquiryDto> {
    return this.platform.updateEnquiry(admin, id, body.status, body.note);
  }

  @Get('billing-invoices')
  @PlatformRoles('owner', 'billing')
  @ApiOperation({ operationId: 'listAllSubscriptionInvoices', summary: 'All our invoices' })
  @ApiOkResponse({ type: BillingInvoicePage })
  invoices(@Query() query: InvoiceListQuery): Promise<BillingInvoicePage> {
    return this.platform.invoices(query.limit, query.cursor, query);
  }

  @Post('billing-invoices/:id/void')
  @HttpCode(200)
  @PlatformRoles('owner', 'billing')
  @ApiOperation({ operationId: 'voidSubscriptionInvoice', summary: 'Void an unpaid invoice' })
  @ApiOkResponse({ type: BillingInvoiceDto })
  voidInvoice(@CurrentPlatformAdmin() admin: PlatformAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() body: PlatformReasonDto): Promise<BillingInvoiceDto> {
    return this.platform.voidInvoice(admin, id, body.reason);
  }

  @Get('bank-transfers')
  @PlatformRoles('owner', 'billing')
  @ApiOperation({ operationId: 'listPendingBankTransfers', summary: 'Bank transfers to confirm' })
  @ApiOkResponse({ type: BillingPaymentPage })
  transfers(@Query() query: PageQuery): Promise<BillingPaymentPage> {
    return this.platform.pendingTransfers(query.limit, query.cursor);
  }

  @Post('billing-payments/:id/confirm')
  @HttpCode(200)
  @PlatformRoles('owner', 'billing')
  @ApiOperation({ operationId: 'confirmBankTransfer', summary: 'Confirm a bank transfer' })
  @ApiOkResponse({ type: BillingPaymentDto })
  confirm(@CurrentPlatformAdmin() admin: PlatformAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() body: ConfirmTransferDto): Promise<BillingPaymentDto> {
    return this.platform.confirmTransfer(admin, id, body.receivedAt, body.amount);
  }

  @Post('billing-payments/:id/reject')
  @HttpCode(200)
  @PlatformRoles('owner', 'billing')
  @ApiOperation({ operationId: 'rejectBankTransfer', summary: 'Reject a bank transfer' })
  @ApiOkResponse({ type: BillingPaymentDto })
  reject(@CurrentPlatformAdmin() admin: PlatformAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() body: PlatformReasonDto): Promise<BillingPaymentDto> {
    return this.platform.rejectTransfer(admin, id, body.reason);
  }

  @Get('plans')
  @ApiOperation({ operationId: 'listAllPlans', summary: 'All plans' })
  @ApiOkResponse({ type: PlanList })
  async plans(): Promise<PlanList> {
    return { data: await this.platform.plans() };
  }

  @Post('plans')
  @PlatformRoles('owner')
  @ApiOperation({ operationId: 'createPlan', summary: 'Create a plan' })
  @ApiCreatedResponse({ type: PlanDto })
  createPlan(@CurrentPlatformAdmin() admin: PlatformAdmin, @Body() body: PlanInputDto): Promise<PlanDto> {
    return this.platform.createPlan(admin, body);
  }

  @Patch('plans/:id')
  @PlatformRoles('owner')
  @ApiOperation({ operationId: 'updatePlan', summary: 'Change a plan' })
  @ApiOkResponse({ type: PlanDto })
  updatePlan(@CurrentPlatformAdmin() admin: PlatformAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() body: PlanInputDto): Promise<PlanDto> {
    return this.platform.updatePlan(admin, id, body);
  }

  @Get('settings')
  @ApiOperation({ operationId: 'listPlatformSettings', summary: 'Platform settings' })
  @ApiOkResponse({ type: SettingList })
  async settings(): Promise<SettingList> {
    return { data: await this.platform.settings() };
  }

  @Put('settings/:key')
  @PlatformRoles('owner')
  @ApiOperation({ operationId: 'updatePlatformSetting', summary: 'Change a platform setting' })
  @ApiOkResponse({ type: SettingDto })
  updateSetting(@CurrentPlatformAdmin() admin: PlatformAdmin, @Param('key') key: string, @Body() body: SettingValueDto): Promise<SettingDto> {
    return this.platform.updateSetting(admin, key, body.value);
  }

  @Get('audit-logs')
  @PlatformRoles('owner')
  @ApiOperation({ operationId: 'listOwnerConsoleAuditLog', summary: 'Owner console audit log' })
  @ApiOkResponse({ type: PlatformAuditPage })
  audit(@Query() query: AuditQuery): Promise<PlatformAuditPage> {
    return this.platform.auditLog(query.limit, query.cursor, query.tenantId, query.from, query.to);
  }
}

/** Owner console (SRS §12; architecture "platform"). */
@Module({
  imports: [BillingModule, OrganizationModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
