import { Injectable } from '@nestjs/common';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { Problems } from '../../core/errors/problem';
import { MeDto } from './dto/me.dto';
import { TenantDto, UpdateTenantDto } from './dto/tenant.dto';
import { UserDto } from './dto/user.dto';
import { TenantPatch, TenantRepository } from './repositories/tenant.repository';
import { UsersRepository } from './repositories/users.repository';

const EDITABLE: (keyof TenantPatch)[] = [
  'name',
  'legalName',
  'tradeLicenseNo',
  'reraOrn',
  'reraBrn',
  'trn',
  'email',
  'phone',
  'address',
  'website',
  'logoFileId',
  'tradeLicenseFileId',
  'timezone',
  'baseCurrency',
];

/** Session and organization profile. */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
  ) {}

  async getMe(principal: Principal): Promise<MeDto> {
    const [user, tenant] = await Promise.all([this.users.findById(principal.userId), this.tenants.find(principal.tenantId)]);
    if (!user || !tenant) throw Problems.unauthorized();
    return {
      user: UserDto.from(user),
      tenant: TenantDto.from(tenant),
      permissions: [...principal.permissions].sort(),
      dataScope: principal.dataScope,
    };
  }

  async getProfile(tenantId: string): Promise<TenantDto> {
    const tenant = await this.tenants.find(tenantId);
    if (!tenant) throw Problems.notFound();
    return TenantDto.from(tenant);
  }

  async updateProfile(tenantId: string, body: UpdateTenantDto): Promise<TenantDto> {
    const before = await this.tenants.find(tenantId);
    if (!before) throw Problems.notFound();
    const patch: TenantPatch = {};
    for (const key of EDITABLE) if (body[key] !== undefined) (patch as Record<string, unknown>)[key] = body[key];
    if (!Object.keys(patch).length) return TenantDto.from(before);

    const after = await this.tenants.update(tenantId, patch);
    if (!after) throw Problems.notFound();
    await this.audit.recordUpdate('tenants', tenantId, pick(before, EDITABLE), pick(after, EDITABLE), 'setting_change');
    return TenantDto.from(after);
  }
}

function pick<T extends object, K extends keyof T>(row: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, row[k]])) as Pick<T, K>;
}
