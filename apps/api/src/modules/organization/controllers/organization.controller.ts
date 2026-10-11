import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequirePermission } from '../../../core/auth/decorators';
import { Principal } from '../../../core/auth/principal';
import { MeDto } from '../dto/me.dto';
import { TenantDto, UpdateTenantDto } from '../dto/tenant.dto';
import { OrganizationService } from '../organization.service';

@ApiTags('Session')
@ApiBearerAuth('bearer')
@Controller('me')
export class MeController {
  constructor(private readonly organization: OrganizationService) {}

  @Get()
  @ApiOperation({ operationId: 'getCurrentUser', summary: 'Get current user' })
  @ApiOkResponse({ type: MeDto })
  getMe(@CurrentPrincipal() principal: Principal): Promise<MeDto> {
    return this.organization.getMe(principal);
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
