import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { SecondaryOwnerDto,
  ActivityDto,
  ActivityPage,
  AssignDto,
  AttachFileDto,
  AttachmentDto,
  AttachmentList,
  BulkLeadActionDto,
  BulkResultDto,
  CheckExistingQuery,
  CheckExistingResult,
  InquiryList,
  LeadCreateDto,
  LeadDto,
  LeadListQuery,
  LeadPage,
  LeadShareDto,
  LeadShareList,
  LeadUpdateDto,
  NoteDto,
  PriorityDto,
  SetProjectsDto,
  ShareDto,
  StageChangeDto,
  TimelineQuery,
} from './dto/lead.dto';
import { LeadActionsService } from './lead-actions.service';
import { LeadsService } from './leads.service';

@ApiTags('Leads')
@ApiBearerAuth('bearer')
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly actions: LeadActionsService,
  ) {}

  @Get()
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listLeads', summary: 'List leads' })
  @ApiOkResponse({ type: LeadPage })
  list(@CurrentPrincipal() p: Principal, @Query() query: LeadListQuery): Promise<LeadPage> {
    return this.leads.list(p, query);
  }

  @Post()
  @RequirePermission('leads.create')
  @ApiOperation({ operationId: 'createLead', summary: 'Create a lead' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: LeadDto })
  create(@CurrentPrincipal() p: Principal, @Body() body: LeadCreateDto): Promise<LeadDto> {
    return this.leads.create(p, body);
  }

  @Get('check-existing')
  @RequirePermission('leads.create')
  @ApiOperation({ operationId: 'checkIfALeadExists', summary: 'Check if a lead exists' })
  @ApiOkResponse({ type: CheckExistingResult })
  checkExisting(@Query() query: CheckExistingQuery): Promise<CheckExistingResult> {
    return this.leads.checkExisting(query.phone, query.email);
  }

  @Post('bulk')
  @HttpCode(200)
  @ApiOperation({ operationId: 'bulkUpdateLeads', summary: 'Bulk action on leads' })
  @ApiOkResponse({ type: BulkResultDto })
  bulk(@CurrentPrincipal() p: Principal, @Body() body: BulkLeadActionDto): Promise<BulkResultDto> {
    return this.actions.bulk(p, body);
  }

  @Get(':id')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getLead', summary: 'Get a lead' })
  @ApiOkResponse({ type: LeadDto })
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<LeadDto> {
    return this.leads.get(p, id);
  }

  @Patch(':id')
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'updateLead', summary: 'Update a lead' })
  @ApiOkResponse({ type: LeadDto })
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: LeadUpdateDto): Promise<LeadDto> {
    return this.leads.update(p, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('leads.delete')
  @ApiOperation({ operationId: 'deleteLead', summary: 'Delete a lead' })
  @ApiNoContentResponse({ description: 'Done' })
  remove(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.leads.remove(p, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('leads.delete')
  @ApiOperation({ operationId: 'restoreLead', summary: 'Restore a deleted lead' })
  @ApiOkResponse({ type: LeadDto })
  restore(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<LeadDto> {
    return this.leads.restore(p, id);
  }

  @Post(':id/stage')
  @HttpCode(200)
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'changeLeadStage', summary: 'Change stage' })
  @ApiOkResponse({ type: LeadDto })
  stage(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: StageChangeDto): Promise<LeadDto> {
    return this.actions.changeStage(p, id, body);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermission('leads.assign')
  @ApiOperation({ operationId: 'assignLead', summary: 'Assign or reassign' })
  @ApiOkResponse({ type: LeadDto })
  assign(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: AssignDto): Promise<LeadDto> {
    return this.actions.assign(p, id, body);
  }

  @Post(':id/priority')
  @HttpCode(200)
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'setLeadPriority', summary: 'Set priority' })
  @ApiOkResponse({ type: LeadDto })
  priority(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: PriorityDto): Promise<LeadDto> {
    return this.actions.setPriority(p, id, body);
  }

  @Put(':id/projects')
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'setLeadProjects', summary: 'Set projects of interest' })
  @ApiOkResponse({ type: LeadDto })
  projects(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: SetProjectsDto): Promise<LeadDto> {
    return this.actions.setProjects(p, id, body);
  }

  @Get(':id/timeline')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getLeadTimeline', summary: 'Lead timeline' })
  @ApiOkResponse({ type: ActivityPage })
  timeline(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Query() query: TimelineQuery): Promise<ActivityPage> {
    return this.actions.timeline(p, id, query);
  }

  @Get(':id/inquiries')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listLeadEnquiries', summary: 'Enquiries of a lead' })
  @ApiOkResponse({ type: InquiryList })
  async inquiries(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<InquiryList> {
    return { data: await this.actions.inquiries(p, id) };
  }

  @Post(':id/notes')
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'addNote', summary: 'Add a note' })
  @ApiCreatedResponse({ type: ActivityDto })
  note(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: NoteDto): Promise<ActivityDto> {
    return this.actions.addNote(p, id, body);
  }

  @Get(':id/shares')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listLeadShares', summary: 'Who a lead is shared with' })
  @ApiOkResponse({ type: LeadShareList })
  async shares(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<LeadShareList> {
    return { data: await this.actions.listShares(p, id) };
  }

  @Post(':id/secondary-owner')
  @HttpCode(200)
  @RequirePermission('leads.assign')
  @ApiOperation({ operationId: 'setSecondaryOwner', summary: 'Set or remove the secondary owner' })
  @ApiOkResponse({ type: LeadDto })
  secondaryOwner(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: SecondaryOwnerDto): Promise<LeadDto> {
    return this.leads.setSecondaryOwner(p, id, body.userId);
  }

  @Post(':id/shares')
  @RequirePermission('leads.share')
  @ApiOperation({ operationId: 'shareLead', summary: 'Share a lead' })
  @ApiCreatedResponse({ type: LeadShareDto })
  share(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ShareDto): Promise<LeadShareDto> {
    return this.actions.share(p, id, body);
  }

  @Delete(':id/shares/:userId')
  @HttpCode(204)
  @RequirePermission('leads.share')
  @ApiOperation({ operationId: 'removeLeadShare', summary: 'Stop sharing a lead' })
  @ApiNoContentResponse({ description: 'Done' })
  unshare(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.actions.unshare(p, id, userId);
  }

  @Get(':id/attachments')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listLeadAttachments', summary: 'Files of a lead' })
  @ApiOkResponse({ type: AttachmentList })
  async attachments(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<AttachmentList> {
    return { data: await this.actions.listAttachments(p, id) };
  }

  @Post(':id/attachments')
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'attachFileToLead', summary: 'Attach a file' })
  @ApiCreatedResponse({ type: AttachmentDto })
  attach(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: AttachFileDto): Promise<AttachmentDto> {
    return this.actions.attach(p, id, body);
  }
}
