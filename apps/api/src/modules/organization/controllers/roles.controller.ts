import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../core/auth/decorators';
import { CreateRoleDto, PermissionList, RoleDto, RoleList, UpdateRoleDto } from '../dto/role.dto';
import { RolesService } from '../roles.service';

@ApiTags('Organization')
@ApiBearerAuth('bearer')
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('roles')
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'listRoles', summary: 'List roles' })
  @ApiOkResponse({ type: RoleList })
  async list(): Promise<RoleList> {
    return { data: await this.roles.list() };
  }

  @Post('roles')
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'createRole', summary: 'Create a role' })
  @ApiCreatedResponse({ type: RoleDto })
  create(@Body() body: CreateRoleDto): Promise<RoleDto> {
    return this.roles.create(body);
  }

  @Patch('roles/:id')
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'updateRole', summary: 'Update a role' })
  @ApiOkResponse({ type: RoleDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateRoleDto): Promise<RoleDto> {
    return this.roles.update(id, body);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'deleteRole', summary: 'Delete a role' })
  @ApiNoContentResponse({ description: 'Done' })
  delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.roles.delete(id);
  }

  @Get('permissions')
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'listPermissions', summary: 'List permissions' })
  @ApiOkResponse({ type: PermissionList })
  async permissions(): Promise<PermissionList> {
    return { data: await this.roles.listPermissions() };
  }
}
