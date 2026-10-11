import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DbService } from '../../core/database/db.service';
import { rolePermissions, roles, TenantRow, tenants, UserRow, users } from './organization.schema';

export interface UserWithRole {
  user: UserRow;
  roleKey: string;
  dataScope: 'own' | 'team' | 'division' | 'company';
}

/** Data access for organization tables. Runs inside the request's tenant transaction (row-level security). */
@Injectable()
export class OrganizationRepository {
  constructor(private readonly db: DbService) {}

  async findUserBySubject(subject: string): Promise<UserWithRole | undefined> {
    const [row] = await this.db.current
      .select({ user: users, roleKey: roles.key, dataScope: roles.dataScope })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.authSubject, subject))
      .limit(1);
    return row;
  }

  /** First login after an invite: link the login provider's subject to the invited user with that email. */
  async linkSubjectByEmail(subject: string, email: string): Promise<boolean> {
    const linked = await this.db.current
      .update(users)
      .set({ authSubject: subject })
      .where(and(sql`${users.email} = ${email}::citext`, isNull(users.authSubject)))
      .returning({ id: users.id });
    return linked.length === 1;
  }

  async findPermissionKeys(roleId: string): Promise<string[]> {
    const rows = await this.db.current
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));
    return rows.map((r) => r.key);
  }

  async findTenant(tenantId: string): Promise<TenantRow | undefined> {
    const [row] = await this.db.current.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return row;
  }

  async findUser(userId: string): Promise<UserRow | undefined> {
    const [row] = await this.db.current.select().from(users).where(eq(users.id, userId)).limit(1);
    return row;
  }
}
