import { Injectable } from '@nestjs/common';
import { Principal } from '../../core/auth/principal';
import { Problems } from '../../core/errors/problem';
import { MeDto, TenantDto, UserDto } from './dto/me.dto';
import { OrganizationRepository } from './organization.repository';

@Injectable()
export class OrganizationService {
  constructor(private readonly repo: OrganizationRepository) {}

  async getMe(principal: Principal): Promise<MeDto> {
    const [user, tenant] = await Promise.all([this.repo.findUser(principal.userId), this.repo.findTenant(principal.tenantId)]);
    if (!user || !tenant) throw Problems.unauthorized();
    return {
      user: UserDto.from(user),
      tenant: TenantDto.from(tenant),
      permissions: [...principal.permissions].sort(),
      dataScope: principal.dataScope,
    };
  }
}
