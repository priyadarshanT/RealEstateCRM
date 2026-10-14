import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { FilesService } from '../../core/files/files.service';
import { AttachFileDto, AttachmentDto, AttachmentList } from '../leads/dto/lead.dto';
import { DealsService } from './deals.service';
import { DealDto, DealInputDto, DealListQuery, DealPage, DealStageChangeDto } from './dto/deal.dto';

const attachment = (a: { id: string; fileId: string; fileName: string; category: string; createdAt: Date }): AttachmentDto => ({
  id: a.id,
  fileId: a.fileId,
  fileName: a.fileName,
  category: a.category,
  createdAt: a.createdAt.toISOString(),
});

@ApiTags('Deals')
@ApiBearerAuth('bearer')
@Controller('deals')
export class DealsController {
  constructor(
    private readonly deals: DealsService,
    private readonly files: FilesService,
  ) {}

  @Get()
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listDeals', summary: 'List deals' })
  @ApiOkResponse({ type: DealPage })
  list(@CurrentPrincipal() p: Principal, @Query() q: DealListQuery): Promise<DealPage> {
    return this.deals.list(p, q);
  }

  @Post()
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'createDeal', summary: 'Open a deal' })
  @ApiCreatedResponse({ type: DealDto })
  async create(@CurrentPrincipal() p: Principal, @Body() body: DealInputDto): Promise<DealDto> {
    return DealDto.from(await this.deals.create(p, body));
  }

  @Get(':id')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getDeal', summary: 'Get a deal' })
  @ApiOkResponse({ type: DealDto })
  async get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<DealDto> {
    return DealDto.from(await this.deals.get(p, id));
  }

  @Patch(':id')
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'updateDeal', summary: 'Update a deal' })
  @ApiOkResponse({ type: DealDto })
  async update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: DealInputDto): Promise<DealDto> {
    return DealDto.from(await this.deals.update(p, id, body));
  }

  @Post(':id/stage')
  @HttpCode(200)
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'changeDealStage', summary: 'Move a deal to EOI, booking, sold or cancelled' })
  @ApiOkResponse({ type: DealDto })
  async stage(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: DealStageChangeDto): Promise<DealDto> {
    return DealDto.from(await this.deals.changeStage(p, id, body));
  }

  @Get(':id/attachments')
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'listDealAttachments', summary: 'Files of a deal' })
  @ApiOkResponse({ type: AttachmentList })
  async attachments(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<AttachmentList> {
    await this.deals.get(p, id);
    return { data: (await this.files.listAttachments({ type: 'deal', id })).map(attachment) };
  }

  @Post(':id/attachments')
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'attachFileToDeal', summary: 'Attach a file to a deal' })
  @ApiCreatedResponse({ type: AttachmentDto })
  async attach(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: AttachFileDto): Promise<AttachmentDto> {
    await this.deals.editable(p, id);
    return attachment(await this.files.attach({ type: 'deal', id }, body.fileId, body.category));
  }
}
