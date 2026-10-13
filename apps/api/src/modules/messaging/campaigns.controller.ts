import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { CampaignsService } from './campaigns.service';
import { AudiencePreviewDto, CampaignDto, CampaignInputDto, CampaignListQuery, CampaignPage, CampaignRejectDto, CampaignReportDto, CampaignTestDto } from './dto/campaign.dto';

@ApiTags('WhatsApp & email')
@ApiBearerAuth('bearer')
@Controller('message-campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermission('campaigns.create')
  @ApiOperation({ operationId: 'listBulkCampaigns', summary: 'List bulk campaigns' })
  @ApiOkResponse({ type: CampaignPage })
  list(@Query() query: CampaignListQuery): Promise<CampaignPage> {
    return this.campaigns.list(query);
  }

  @Post()
  @RequirePermission('campaigns.create')
  @ApiOperation({ operationId: 'createBulkCampaign', summary: 'Create bulk campaign' })
  @ApiCreatedResponse({ type: CampaignDto })
  create(@CurrentPrincipal() p: Principal, @Body() body: CampaignInputDto): Promise<CampaignDto> {
    return this.campaigns.create(p, body);
  }

  @Get(':id')
  @RequirePermission('campaigns.create')
  @ApiOperation({ operationId: 'getBulkCampaign', summary: 'Get bulk campaign' })
  @ApiOkResponse({ type: CampaignDto })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<CampaignDto> {
    return CampaignDto.from(await this.campaigns.get(id));
  }

  @Patch(':id')
  @RequirePermission('campaigns.create')
  @ApiOperation({ operationId: 'updateBulkCampaign', summary: 'Update bulk campaign' })
  @ApiOkResponse({ type: CampaignDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: CampaignInputDto): Promise<CampaignDto> {
    return this.campaigns.update(id, body);
  }

  @Post(':id/preview-audience')
  @HttpCode(200)
  @RequirePermission('campaigns.create')
  @ApiOperation({ operationId: 'previewCampaignAudience', summary: 'Preview campaign audience' })
  @ApiOkResponse({ type: AudiencePreviewDto })
  preview(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<AudiencePreviewDto> {
    return this.campaigns.previewAudience(p, id);
  }

  @Post(':id/test')
  @HttpCode(202)
  @RequirePermission('campaigns.create')
  @ApiOperation({ operationId: 'sendCampaignTest', summary: 'Send campaign test' })
  @ApiAcceptedResponse()
  test(@Param('id', ParseUUIDPipe) id: string, @Body() body: CampaignTestDto): Promise<void> {
    return this.campaigns.sendTest(id, body.to);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('campaigns.create')
  @ApiOperation({ operationId: 'submitCampaignForApproval', summary: 'Submit campaign for approval' })
  @ApiOkResponse({ type: CampaignDto })
  submit(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<CampaignDto> {
    return this.campaigns.submit(p, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('campaigns.approve')
  @ApiOperation({ operationId: 'approveCampaign', summary: 'Approve campaign' })
  @ApiOkResponse({ type: CampaignDto })
  approve(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<CampaignDto> {
    return this.campaigns.approve(p, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('campaigns.approve')
  @ApiOperation({ operationId: 'rejectCampaign', summary: 'Reject campaign' })
  @ApiOkResponse({ type: CampaignDto })
  reject(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: CampaignRejectDto): Promise<CampaignDto> {
    return this.campaigns.reject(p, id, body.note);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('campaigns.create')
  @ApiOperation({ operationId: 'cancelCampaign', summary: 'Cancel campaign' })
  @ApiOkResponse({ type: CampaignDto })
  cancel(@Param('id', ParseUUIDPipe) id: string): Promise<CampaignDto> {
    return this.campaigns.cancel(id);
  }

  @Get(':id/report')
  @RequirePermission('campaigns.create')
  @ApiOperation({ operationId: 'getCampaignReport', summary: 'Get campaign report' })
  @ApiOkResponse({ type: CampaignReportDto })
  report(@Param('id', ParseUUIDPipe) id: string): Promise<CampaignReportDto> {
    return this.campaigns.report(id);
  }
}
