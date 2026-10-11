import { Injectable } from '@nestjs/common';
import { Principal, PrincipalResolver, VerifiedToken } from '../../core/auth/principal';
import { OrganizationRepository } from './organization.repository';

/** Resolves a verified login token to an active user of the token's tenant. */
@Injectable()
export class OrganizationPrincipalResolver implements PrincipalResolver {
  constructor(private readonly repo: OrganizationRepository) {}

  async resolve(token: VerifiedToken): Promise<Principal | null> {
    let found = await this.repo.findUserBySubject(token.subject);
    if (!found && token.email && (await this.repo.linkSubjectByEmail(token.subject, token.email))) {
      found = await this.repo.findUserBySubject(token.subject);
    }
    if (!found || found.user.status !== 'active') return null;

    const tenant = await this.repo.findTenant(found.user.tenantId);
    if (!tenant) return null;
    return {
      userId: found.user.id,
      tenantId: found.user.tenantId,
      email: found.user.email,
      roleKey: found.roleKey,
      dataScope: found.dataScope,
      permissions: new Set(await this.repo.findPermissionKeys(found.user.roleId)),
      tenantStatus: tenant.status,
    };
  }
}
