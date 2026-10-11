import { Injectable } from '@nestjs/common';
import { AuditService } from '../../core/audit/audit.service';
import { Principal, PrincipalResolver, VerifiedToken } from '../../core/auth/principal';
import { isSeatLimit, OrgErrors } from './organization.errors';
import { RolesRepository } from './repositories/roles.repository';
import { TenantRepository } from './repositories/tenant.repository';
import { UsersRepository } from './repositories/users.repository';

/**
 * Resolves a verified login token to an active user of the token's tenant.
 * First login of an invited user links the login and activates them, which takes a seat (SRS §12 Seats).
 * Each new sign-in (auth_time) is recorded in the audit log (SRS §14).
 */
@Injectable()
export class OrganizationPrincipalResolver implements PrincipalResolver {
  constructor(
    private readonly users: UsersRepository,
    private readonly roles: RolesRepository,
    private readonly tenants: TenantRepository,
    private readonly audit: AuditService,
  ) {}

  async resolve(token: VerifiedToken): Promise<Principal | null> {
    let found = await this.users.findBySubject(token.subject);
    if (!found && token.email && (await this.users.linkSubjectByEmail(token.subject, token.email))) {
      found = await this.users.findBySubject(token.subject);
    }
    if (!found || found.user.status === 'inactive') return null;
    const { user } = found;

    const isNewSignIn = token.authTime && (!user.lastLoginAt || token.authTime > user.lastLoginAt);
    if (user.status === 'invited' || isNewSignIn) {
      try {
        await this.users.update(user.id, {
          ...(user.status === 'invited' ? { status: 'active' as const } : {}),
          ...(isNewSignIn ? { lastLoginAt: token.authTime } : {}),
        });
      } catch (err) {
        if (isSeatLimit(err)) throw OrgErrors.seatLimitReached();
        throw err;
      }
      if (user.status === 'invited') await this.audit.record('update', 'users', user.id, { status: ['invited', 'active'] }, user.id);
      if (isNewSignIn) await this.audit.record('login', 'users', user.id, null, user.id);
    }

    const tenant = await this.tenants.find(user.tenantId);
    if (!tenant) return null;
    return {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      roleKey: found.roleKey,
      dataScope: found.dataScope,
      permissions: new Set(await this.roles.permissionKeys(user.roleId)),
      tenantStatus: tenant.status,
    };
  }
}
