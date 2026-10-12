import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RequirePermission } from '../../core/auth/decorators';
import { parseIfMatch, toEtag } from '../../core/http/etag';
import { PageQuery } from '../../core/http/pagination';
import {
  LeadSourceDto,
  LeadSourceInputDto,
  LeadSourcePage,
  LeadStageDto,
  LeadStageInputDto,
  LeadStagePage,
  ReasonDto,
  ReasonInputDto,
  ReasonListQuery,
  ReasonPage,
} from './dto/settings.dto';
import { LeadConfigService } from './lead-config.service';

@ApiTags('Settings')
@ApiBearerAuth('bearer')
@Controller('lead-stages')
export class LeadStagesController {
  constructor(private readonly config: LeadConfigService) {}

  @Get()
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listLeadStages', summary: 'List lead stages' })
  @ApiOkResponse({ type: LeadStagePage })
  list(@Query() query: PageQuery): Promise<LeadStagePage> {
    return this.config.listStages(query.limit, query.cursor);
  }

  @Post()
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'createLeadStage', summary: 'Create a lead stage' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: LeadStageDto })
  async create(@Body() body: LeadStageInputDto, @Res({ passthrough: true }) res: Response): Promise<LeadStageDto> {
    const stage = await this.config.createStage(body);
    res.setHeader('ETag', toEtag(stage.updatedAt));
    return LeadStageDto.from(stage);
  }

  @Get(':id')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getLeadStage', summary: 'Get a lead stage' })
  @ApiOkResponse({ type: LeadStageDto })
  async get(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<LeadStageDto> {
    const stage = await this.config.getStage(id);
    res.setHeader('ETag', toEtag(stage.updatedAt));
    return LeadStageDto.from(stage);
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'updateLeadStage', summary: 'Update a lead stage' })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiOkResponse({ type: LeadStageDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LeadStageInputDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LeadStageDto> {
    const stage = await this.config.updateStage(id, body, parseIfMatch(ifMatch));
    res.setHeader('ETag', toEtag(stage.updatedAt));
    return LeadStageDto.from(stage);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'deleteLeadStage', summary: 'Delete a lead stage' })
  @ApiNoContentResponse({ description: 'Done' })
  delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.config.deleteStage(id);
  }
}

@ApiTags('Settings')
@ApiBearerAuth('bearer')
@Controller('reasons')
export class ReasonsController {
  constructor(private readonly config: LeadConfigService) {}

  @Get()
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listReasons', summary: 'List reasons' })
  @ApiOkResponse({ type: ReasonPage })
  list(@Query() query: ReasonListQuery): Promise<ReasonPage> {
    return this.config.listReasons(query);
  }

  @Post()
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'createReason', summary: 'Create a reason' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: ReasonDto })
  async create(@Body() body: ReasonInputDto): Promise<ReasonDto> {
    return ReasonDto.from(await this.config.createReason(body));
  }

  @Get(':id')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getReason', summary: 'Get a reason' })
  @ApiOkResponse({ type: ReasonDto })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<ReasonDto> {
    return ReasonDto.from(await this.config.getReason(id));
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'updateReason', summary: 'Update a reason' })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiOkResponse({ type: ReasonDto })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonInputDto): Promise<ReasonDto> {
    return ReasonDto.from(await this.config.updateReason(id, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'deleteReason', summary: 'Delete a reason' })
  @ApiNoContentResponse({ description: 'Done' })
  delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.config.deleteReason(id);
  }
}

@ApiTags('Settings')
@ApiBearerAuth('bearer')
@Controller('lead-sources')
export class LeadSourcesController {
  constructor(private readonly config: LeadConfigService) {}

  @Get()
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listLeadSources', summary: 'List lead sources' })
  @ApiOkResponse({ type: LeadSourcePage })
  list(@Query() query: PageQuery): Promise<LeadSourcePage> {
    return this.config.listSources(query.limit, query.cursor);
  }

  @Post()
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'createLeadSource', summary: 'Create a lead source' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: LeadSourceDto })
  async create(@Body() body: LeadSourceInputDto): Promise<LeadSourceDto> {
    return LeadSourceDto.from(await this.config.createSource(body));
  }

  @Get(':id')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getLeadSource', summary: 'Get a lead source' })
  @ApiOkResponse({ type: LeadSourceDto })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<LeadSourceDto> {
    return LeadSourceDto.from(await this.config.getSource(id));
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'updateLeadSource', summary: 'Update a lead source' })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiOkResponse({ type: LeadSourceDto })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: LeadSourceInputDto): Promise<LeadSourceDto> {
    return LeadSourceDto.from(await this.config.updateSource(id, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'deleteLeadSource', summary: 'Delete a lead source' })
  @ApiNoContentResponse({ description: 'Done' })
  delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.config.deleteSource(id);
  }
}
