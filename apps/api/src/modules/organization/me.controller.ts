import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { MeDto } from './dto/me.dto';
import { OrganizationService } from './organization.service';

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
