import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RequirePermission } from '../../../core/auth/decorators';
import { parseIfMatch, toEtag } from '../../../core/http/etag';
import { ColleagueList, CreateUserDto, DeactivateUserDto, ReceivesLeadsDto, UpdateUserDto, UserDto, UserListQuery, UserPage } from '../dto/user.dto';
import { UserRow } from '../organization.schema';
import { UsersService } from '../users.service';

@ApiTags('Organization')
@ApiBearerAuth('bearer')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'listUsers', summary: 'List users' })
  @ApiOkResponse({ type: UserPage })
  list(@Query() query: UserListQuery): Promise<UserPage> {
    return this.users.list(query);
  }

  @Post()
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'createUser', summary: 'Invite a user' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: UserDto })
  async create(@Body() body: CreateUserDto, @Res({ passthrough: true }) res: Response): Promise<UserDto> {
    return withEtag(res, await this.users.create(body));
  }

  // Declared before ':id' so "directory" is not read as a user ID. Any signed-in user: no RequirePermission.
  @Get('directory')
  @ApiOperation({ operationId: 'listColleagues', summary: 'List colleagues' })
  @ApiOkResponse({ type: ColleagueList })
  async directory(): Promise<ColleagueList> {
    return { data: await this.users.directory() };
  }

  @Get(':id')
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'getUser', summary: 'Get a user' })
  @ApiOkResponse({ type: UserDto })
  async get(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<UserDto> {
    return withEtag(res, await this.users.get(id));
  }

  @Patch(':id')
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'updateUser', summary: 'Update a user' })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiOkResponse({ type: UserDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserDto> {
    return withEtag(res, await this.users.update(id, body, parseIfMatch(ifMatch)));
  }

  @Put(':id/receives-leads')
  @RequirePermission('users.lead_assignment')
  @ApiOperation({ operationId: 'turnLeadAssignmentOnOrOff', summary: 'Turn lead assignment on or off' })
  @ApiOkResponse({ type: UserDto })
  async receivesLeads(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReceivesLeadsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserDto> {
    return withEtag(res, await this.users.setReceivesLeads(id, body.receivesLeads));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'deactivateUser', summary: 'Deactivate a user' })
  @ApiOkResponse({ type: UserDto })
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DeactivateUserDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserDto> {
    return withEtag(res, await this.users.deactivate(id, body));
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'reactivateUser', summary: 'Reactivate a user' })
  @ApiOkResponse({ type: UserDto })
  async reactivate(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<UserDto> {
    return withEtag(res, await this.users.reactivate(id));
  }
}

function withEtag(res: Response, user: UserRow): UserDto {
  res.setHeader('ETag', toEtag(user.updatedAt));
  return UserDto.from(user);
}
