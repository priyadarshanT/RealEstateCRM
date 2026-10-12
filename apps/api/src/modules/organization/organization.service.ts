import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DbService } from '../../core/database/db.service';
import { roles, tenants, users } from './organization.schema';
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
    private readonly db: DbService,
  ) {}

  /**
   * Creates a company with its default roles, stages, reasons and settings (create_tenant_defaults) and its first
   * Admin, who is invited and takes a seat on first login. Runs inside a transaction for the new tenant ID
   * (architecture: tenant.signed_up → organization creates the company).
   */
  async createCompany(input: {
    tenantId: string;
    type: 'brokerage' | 'individual';
    name: string;
    tradeLicenseNo?: string | null;
    reraOrn?: string | null;
    reraBrn?: string | null;
    email: string;
    phone?: string | null;
    adminFullName: string;
    adminEmail: string;
    adminPhone?: string | null;
  }): Promise<{ adminUserId: string }> {
    if (this.db.currentTenantId !== input.tenantId) throw new Error('createCompany runs inside the new tenant transaction');
    await this.db.current.insert(tenants).values({
      id: input.tenantId,
      type: input.type,
      name: input.name,
      legalName: input.name,
      tradeLicenseNo: input.tradeLicenseNo ?? null,
      reraOrn: input.reraOrn ?? null,
      reraBrn: input.reraBrn ?? null,
      email: input.email,
      phone: input.phone ?? null,
    } as typeof tenants.$inferInsert);
    await this.db.current.execute(sql`SELECT create_tenant_defaults(${input.tenantId}::uuid)`);
    const [admin] = await this.db.current.select({ id: roles.id }).from(roles).where(eq(roles.key, 'admin')).limit(1);
    const [user] = await this.db.current
      .insert(users)
      .values({ tenantId: input.tenantId, email: input.adminEmail, fullName: input.adminFullName, phone: input.adminPhone ?? null, roleId: admin!.id, status: 'invited' })
      .returning({ id: users.id });
    await this.audit.record('create', 'tenants', input.tenantId, { name: [null, input.name], type: [null, input.type] });
    return { adminUserId: user!.id };
  }

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
