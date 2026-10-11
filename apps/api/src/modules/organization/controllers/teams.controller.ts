import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RequirePermission } from '../../../core/auth/decorators';
import { parseIfMatch, toEtag } from '../../../core/http/etag';
import { PageQuery } from '../../../core/http/pagination';
import { DivisionDto, DivisionInputDto, DivisionPage, TeamDto, TeamInputDto, TeamPage } from '../dto/team.dto';
import { TeamsService } from '../teams.service';

@ApiTags('Organization')
@ApiBearerAuth('bearer')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'listTeams', summary: 'List teams' })
  @ApiOkResponse({ type: TeamPage })
  list(@Query() query: PageQuery): Promise<TeamPage> {
    return this.teams.listTeams(query.limit, query.cursor);
  }

  @Post()
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'createTeam', summary: 'Create a team' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: TeamDto })
  async create(@Body() body: TeamInputDto, @Res({ passthrough: true }) res: Response): Promise<TeamDto> {
    const team = await this.teams.createTeam(body);
    res.setHeader('ETag', toEtag(team.updatedAt));
    return TeamDto.from(team);
  }

  @Get(':id')
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'getTeam', summary: 'Get a team' })
  @ApiOkResponse({ type: TeamDto })
  async get(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<TeamDto> {
    const team = await this.teams.getTeam(id);
    res.setHeader('ETag', toEtag(team.updatedAt));
    return TeamDto.from(team);
  }

  @Patch(':id')
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'updateTeam', summary: 'Update a team' })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiOkResponse({ type: TeamDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TeamInputDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TeamDto> {
    const team = await this.teams.updateTeam(id, body, parseIfMatch(ifMatch));
    res.setHeader('ETag', toEtag(team.updatedAt));
    return TeamDto.from(team);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'deleteTeam', summary: 'Delete a team' })
  @ApiNoContentResponse({ description: 'Done' })
  delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.teams.deleteTeam(id);
  }
}

@ApiTags('Organization')
@ApiBearerAuth('bearer')
@Controller('divisions')
export class DivisionsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'listDivisions', summary: 'List divisions' })
  @ApiOkResponse({ type: DivisionPage })
  list(@Query() query: PageQuery): Promise<DivisionPage> {
    return this.teams.listDivisions(query.limit, query.cursor);
  }

  @Post()
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'createDivision', summary: 'Create a division' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: DivisionDto })
  async create(@Body() body: DivisionInputDto, @Res({ passthrough: true }) res: Response): Promise<DivisionDto> {
    const division = await this.teams.createDivision(body);
    res.setHeader('ETag', toEtag(division.updatedAt));
    return DivisionDto.from(division);
  }

  @Get(':id')
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'getDivision', summary: 'Get a division' })
  @ApiOkResponse({ type: DivisionDto })
  async get(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<DivisionDto> {
    const division = await this.teams.getDivision(id);
    res.setHeader('ETag', toEtag(division.updatedAt));
    return DivisionDto.from(division);
  }

  @Patch(':id')
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'updateDivision', summary: 'Update a division' })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiOkResponse({ type: DivisionDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DivisionInputDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DivisionDto> {
    const division = await this.teams.updateDivision(id, body, parseIfMatch(ifMatch));
    res.setHeader('ETag', toEtag(division.updatedAt));
    return DivisionDto.from(division);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'deleteDivision', summary: 'Delete a division' })
  @ApiNoContentResponse({ description: 'Done' })
  delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.teams.deleteDivision(id);
  }
}
