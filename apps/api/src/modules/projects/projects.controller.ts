import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { FilesService } from '../../core/files/files.service';
import { parseIfMatch, toEtag } from '../../core/http/etag';
import { PageQuery } from '../../core/http/pagination';
import { AttachFileDto, AttachmentDto, AttachmentList } from '../leads/dto/lead.dto';
import {
  CategoryCountList,
  BuildingDto,
  BuildingInputDto,
  BuildingList,
  DeveloperDto,
  DeveloperInputDto,
  DeveloperPage,
  ProjectAttachDto,
  ProjectDto,
  ProjectInputDto,
  ProjectListQuery,
  ProjectPage,
  UnitChangeList,
  UnitDto,
  UnitInputDto,
  UnitListQuery,
  UnitPage,
  UnitStatusChangeDto,
} from './dto/projects.dto';
import { ProjectsService } from './projects.service';
import { UnitsService } from './units.service';

const attachment = (a: { id: string; fileId: string; fileName: string; category: string; createdAt: Date }): AttachmentDto => ({
  id: a.id,
  fileId: a.fileId,
  fileName: a.fileName,
  category: a.category,
  createdAt: a.createdAt.toISOString(),
});

@ApiTags('Projects')
@ApiBearerAuth('bearer')
@Controller()
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly units: UnitsService,
    private readonly files: FilesService,
  ) {}

  // ---------------------------------------------------------------- developers
  @Get('developers')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listDevelopers', summary: 'List developers' })
  @ApiOkResponse({ type: DeveloperPage })
  listDevelopers(@Query() q: PageQuery): Promise<DeveloperPage> {
    return this.projects.listDevelopers(q.limit, q.cursor);
  }

  @Post('developers')
  @RequirePermission('projects.manage')
  @ApiOperation({ operationId: 'createDeveloper', summary: 'Create a developer' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: DeveloperDto })
  async createDeveloper(@Body() body: DeveloperInputDto, @Res({ passthrough: true }) res: Response): Promise<DeveloperDto> {
    const row = await this.projects.createDeveloper(body);
    res.setHeader('ETag', toEtag(row.updatedAt));
    return DeveloperDto.from(row);
  }

  @Get('developers/:id')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getDeveloper', summary: 'Get a developer' })
  @ApiOkResponse({ type: DeveloperDto })
  async getDeveloper(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<DeveloperDto> {
    const row = await this.projects.getDeveloper(id);
    res.setHeader('ETag', toEtag(row.updatedAt));
    return DeveloperDto.from(row);
  }

  @Patch('developers/:id')
  @RequirePermission('projects.manage')
  @ApiOperation({ operationId: 'updateDeveloper', summary: 'Update a developer' })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiOkResponse({ type: DeveloperDto })
  async updateDeveloper(@Param('id', ParseUUIDPipe) id: string, @Body() body: DeveloperInputDto, @Headers('if-match') ifMatch: string | undefined, @Res({ passthrough: true }) res: Response): Promise<DeveloperDto> {
    const row = await this.projects.updateDeveloper(id, body, parseIfMatch(ifMatch));
    res.setHeader('ETag', toEtag(row.updatedAt));
    return DeveloperDto.from(row);
  }

  @Delete('developers/:id')
  @HttpCode(204)
  @RequirePermission('projects.manage')
  @ApiOperation({ operationId: 'deleteDeveloper', summary: 'Delete a developer' })
  @ApiNoContentResponse({ description: 'Done' })
  deleteDeveloper(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.projects.deleteDeveloper(id);
  }

  // ---------------------------------------------------------------- projects
  @Get('projects')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listProjects', summary: 'List projects' })
  @ApiOkResponse({ type: ProjectPage })
  listProjects(@Query() q: ProjectListQuery): Promise<ProjectPage> {
    return this.projects.listProjects(q);
  }

  @Get('projects/category-counts')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'countProjectsByCategory', summary: 'Project counts per category (tabs)' })
  @ApiOkResponse({ type: CategoryCountList })
  categoryCounts(@Query() q: ProjectListQuery): Promise<CategoryCountList> {
    return this.projects.categoryCounts(q);
  }

  @Post('projects')
  @RequirePermission('projects.manage')
  @ApiOperation({ operationId: 'createProject', summary: 'Create a project' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: ProjectDto })
  async createProject(@Body() body: ProjectInputDto, @Res({ passthrough: true }) res: Response): Promise<ProjectDto> {
    const row = await this.projects.createProject(body);
    res.setHeader('ETag', toEtag(row.updatedAt));
    return this.projects.projectDto(row);
  }

  @Get('projects/:id')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getProject', summary: 'Get a project' })
  @ApiOkResponse({ type: ProjectDto })
  async getProject(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<ProjectDto> {
    const row = await this.projects.getProject(id);
    res.setHeader('ETag', toEtag(row.updatedAt));
    return this.projects.projectDto(row);
  }

  @Patch('projects/:id')
  @RequirePermission('projects.manage')
  @ApiOperation({ operationId: 'updateProject', summary: 'Update a project' })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiOkResponse({ type: ProjectDto })
  async updateProject(@Param('id', ParseUUIDPipe) id: string, @Body() body: ProjectInputDto, @Headers('if-match') ifMatch: string | undefined, @Res({ passthrough: true }) res: Response): Promise<ProjectDto> {
    const row = await this.projects.updateProject(id, body, parseIfMatch(ifMatch));
    res.setHeader('ETag', toEtag(row.updatedAt));
    return this.projects.projectDto(row);
  }

  @Delete('projects/:id')
  @HttpCode(204)
  @RequirePermission('projects.manage')
  @ApiOperation({ operationId: 'deleteProject', summary: 'Delete a project' })
  @ApiNoContentResponse({ description: 'Done' })
  deleteProject(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.projects.deleteProject(id);
  }

  @Post('projects/:id/attachments')
  @RequirePermission('projects.manage')
  @ApiOperation({ operationId: 'attachFileToProject', summary: 'Attach a file to a project' })
  @ApiCreatedResponse({ type: AttachmentDto })
  async attachToProject(@Param('id', ParseUUIDPipe) id: string, @Body() body: ProjectAttachDto): Promise<AttachmentDto> {
    await this.projects.getProject(id);
    return attachment(await this.files.attach({ type: 'project', id }, body.fileId, body.category, body.sortOrder ?? 0));
  }

  // ---------------------------------------------------------------- buildings
  @Get('projects/:id/buildings')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listBuildings', summary: 'Buildings of a project' })
  @ApiOkResponse({ type: BuildingList })
  async listBuildings(@Param('id', ParseUUIDPipe) id: string): Promise<BuildingList> {
    return { data: (await this.projects.listBuildings(id)).map(BuildingDto.from) };
  }

  @Post('projects/:id/buildings')
  @RequirePermission('projects.manage')
  @ApiOperation({ operationId: 'createBuilding', summary: 'Add a building' })
  @ApiCreatedResponse({ type: BuildingDto })
  async createBuilding(@Param('id', ParseUUIDPipe) id: string, @Body() body: BuildingInputDto): Promise<BuildingDto> {
    return BuildingDto.from(await this.projects.createBuilding(id, body));
  }

  @Patch('buildings/:id')
  @RequirePermission('projects.manage')
  @ApiOperation({ operationId: 'updateBuilding', summary: 'Update a building' })
  @ApiOkResponse({ type: BuildingDto })
  async updateBuilding(@Param('id', ParseUUIDPipe) id: string, @Body() body: BuildingInputDto): Promise<BuildingDto> {
    return BuildingDto.from(await this.projects.updateBuilding(id, body));
  }

  // ---------------------------------------------------------------- units
  @Get('units')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listUnits', summary: 'List units' })
  @ApiOkResponse({ type: UnitPage })
  listUnits(@Query() q: UnitListQuery): Promise<UnitPage> {
    return this.units.list(q);
  }

  @Post('units')
  @RequirePermission('projects.manage')
  @ApiOperation({ operationId: 'createUnit', summary: 'Create a unit' })
  @ApiCreatedResponse({ type: UnitDto })
  async createUnit(@Body() body: UnitInputDto): Promise<UnitDto> {
    return UnitDto.from(await this.units.create(body));
  }

  @Get('units/:id')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getUnit', summary: 'Get a unit' })
  @ApiOkResponse({ type: UnitDto })
  async getUnit(@Param('id', ParseUUIDPipe) id: string): Promise<UnitDto> {
    return UnitDto.from(await this.units.get(id));
  }

  @Patch('units/:id')
  @RequirePermission('projects.manage')
  @ApiOperation({ operationId: 'updateUnitDetails', summary: 'Update unit details' })
  @ApiOkResponse({ type: UnitDto })
  async updateUnit(@Param('id', ParseUUIDPipe) id: string, @Body() body: UnitInputDto): Promise<UnitDto> {
    return UnitDto.from(await this.units.update(id, body));
  }

  @Post('units/:id/status')
  @HttpCode(200)
  @RequirePermission('units.change_status')
  @ApiOperation({ operationId: 'changeUnitStatusOrPrice', summary: 'Change unit status or price' })
  @ApiOkResponse({ type: UnitDto })
  async changeStatus(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: UnitStatusChangeDto): Promise<UnitDto> {
    return UnitDto.from(await this.units.changeStatus(id, body, p.userId));
  }

  @Get('units/:id/history')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getUnitPriceAndStatusHistory', summary: 'Unit price and status history' })
  @ApiOkResponse({ type: UnitChangeList })
  async history(@Param('id', ParseUUIDPipe) id: string): Promise<UnitChangeList> {
    return { data: await this.units.history(id) };
  }

  @Get('units/:id/attachments')
  @RequirePermission('projects.manage')
  @ApiOperation({ operationId: 'listUnitAttachments', summary: 'Files of a unit' })
  @ApiOkResponse({ type: AttachmentList })
  async unitAttachments(@Param('id', ParseUUIDPipe) id: string): Promise<AttachmentList> {
    await this.units.get(id);
    return { data: (await this.files.listAttachments({ type: 'unit', id })).map(attachment) };
  }

  @Post('units/:id/attachments')
  @RequirePermission('projects.manage')
  @ApiOperation({ operationId: 'attachFileToUnit', summary: 'Attach a file to a unit' })
  @ApiCreatedResponse({ type: AttachmentDto })
  async attachToUnit(@Param('id', ParseUUIDPipe) id: string, @Body() body: AttachFileDto): Promise<AttachmentDto> {
    await this.units.get(id);
    return attachment(await this.files.attach({ type: 'unit', id }, body.fileId, body.category));
  }
}
