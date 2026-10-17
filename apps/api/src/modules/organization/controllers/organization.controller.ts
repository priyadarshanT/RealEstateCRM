import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequirePermission } from '../../../core/auth/decorators';
import { Principal } from '../../../core/auth/principal';
import { MeDto } from '../dto/me.dto';
import { TenantDto, UpdateTenantDto } from '../dto/tenant.dto';
import { ListColumnsDto, ListColumnsService, SaveListColumnsDto } from '../list-columns.service';
import { OrganizationService } from '../organization.service';

@ApiTags('Session')
@ApiBearerAuth('bearer')
@Controller('me')
export class MeController {
  constructor(
    private readonly organization: OrganizationService,
    private readonly listColumns: ListColumnsService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'getCurrentUser', summary: 'Get current user' })
  @ApiOkResponse({ type: MeDto })
  getMe(@CurrentPrincipal() principal: Principal): Promise<MeDto> {
    return this.organization.getMe(principal);
  }

  @Get('list-columns/:list')
  @ApiOperation({ operationId: 'getMyListColumns', summary: 'My columns for a list (Manage Columns)' })
  @ApiOkResponse({ type: ListColumnsDto })
  getColumns(@CurrentPrincipal() p: Principal, @Param('list') list: string): Promise<ListColumnsDto> {
    return this.listColumns.get(p.userId, list);
  }

  @Put('list-columns/:list')
  @ApiOperation({ operationId: 'saveMyListColumns', summary: 'Save my columns for a list' })
  @ApiOkResponse({ type: ListColumnsDto })
  saveColumns(@CurrentPrincipal() p: Principal, @Param('list') list: string, @Body() body: SaveListColumnsDto): Promise<ListColumnsDto> {
    return this.listColumns.save(p.userId, list, body.columns);
  }

  @Delete('list-columns/:list')
  @HttpCode(204)
  @ApiOperation({ operationId: 'resetMyListColumns', summary: 'Reset my columns to the default' })
  @ApiNoContentResponse({ description: 'Done' })
  resetColumns(@CurrentPrincipal() p: Principal, @Param('list') list: string): Promise<void> {
    return this.listColumns.reset(p.userId, list);
  }
}

@ApiTags('Organization')
@ApiBearerAuth('bearer')
@Controller('organization')
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get()
  @ApiOperation({ operationId: 'getOrganizationProfile', summary: 'Get organization profile' })
  @ApiOkResponse({ type: TenantDto })
  get(@CurrentPrincipal() principal: Principal): Promise<TenantDto> {
    return this.organization.getProfile(principal.tenantId);
  }

  @Patch()
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'updateOrganizationProfile', summary: 'Update organization profile' })
  @ApiOkResponse({ type: TenantDto })
  update(@CurrentPrincipal() principal: Principal, @Body() body: UpdateTenantDto): Promise<TenantDto> {
    return this.organization.updateProfile(principal.tenantId, body);
  }
}
