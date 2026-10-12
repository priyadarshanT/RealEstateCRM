import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RequirePermission } from '../../core/auth/decorators';
import { parseIfMatch, toEtag } from '../../core/http/etag';
import { AdSpendList, CampaignDto, CampaignInputDto, CampaignListQuery, CampaignPage, EnterSpendDto, MarketingService, SpendQuery } from './marketing.service';

@ApiTags('Marketing')
@ApiBearerAuth('bearer')
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly marketing: MarketingService) {}

  @Get()
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listCampaigns', summary: 'List ad campaigns' })
  @ApiOkResponse({ type: CampaignPage })
  list(@Query() query: CampaignListQuery): Promise<CampaignPage> {
    return this.marketing.list(query);
  }

  @Post()
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'createCampaign', summary: 'Create a campaign' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: CampaignDto })
  async create(@Body() body: CampaignInputDto, @Res({ passthrough: true }) res: Response): Promise<CampaignDto> {
    const row = await this.marketing.create(body);
    res.setHeader('ETag', toEtag(row.updatedAt));
    return CampaignDto.from(row);
  }

  @Get(':id')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getCampaign', summary: 'Get a campaign' })
  @ApiOkResponse({ type: CampaignDto })
  async get(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<CampaignDto> {
    const row = await this.marketing.get(id);
    res.setHeader('ETag', toEtag(row.updatedAt));
    return CampaignDto.from(row);
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'updateCampaign', summary: 'Update a campaign' })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiOkResponse({ type: CampaignDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CampaignInputDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CampaignDto> {
    const row = await this.marketing.update(id, body, parseIfMatch(ifMatch));
    res.setHeader('ETag', toEtag(row.updatedAt));
    return CampaignDto.from(row);
  }

  @Get(':id/spend')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listCampaignSpend', summary: 'Daily spend of a campaign' })
  @ApiOkResponse({ type: AdSpendList })
  async spend(@Param('id', ParseUUIDPipe) id: string, @Query() query: SpendQuery): Promise<AdSpendList> {
    return { data: await this.marketing.spend(id, query) };
  }

  @Put(':id/spend')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'enterCampaignSpend', summary: 'Enter daily spend by hand' })
  @ApiNoContentResponse({ description: 'Done' })
  enterSpend(@Param('id', ParseUUIDPipe) id: string, @Body() body: EnterSpendDto): Promise<void> {
    return this.marketing.enterSpend(id, body.days);
  }
}
