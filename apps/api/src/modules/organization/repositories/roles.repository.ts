import { Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { DbService } from '../../../core/database/db.service';
import { permissions, rolePermissions, RoleRow, roles } from '../organization.schema';

export type RolePatch = Partial<Pick<RoleRow, 'key' | 'name' | 'dataScope'>>;

@Injectable()
export class RolesRepository {
  constructor(private readonly db: DbService) {}

  async list(): Promise<RoleRow[]> {
    return this.db.current.select().from(roles).orderBy(asc(roles.name));
  }

  async findById(id: string): Promise<RoleRow | undefined> {
    const [row] = await this.db.current.select().from(roles).where(eq(roles.id, id)).limit(1);
    return row;
  }

  async keyExists(key: string): Promise<boolean> {
    const rows = await this.db.current.select({ id: roles.id }).from(roles).where(eq(roles.key, key)).limit(1);
    return rows.length > 0;
  }

  async create(values: Pick<RoleRow, 'key' | 'name' | 'dataScope'>, tenantId: string): Promise<RoleRow> {
    const [row] = await this.db.current.insert(roles).values({ ...values, tenantId, isSystem: false }).returning();
    return row!;
  }

  async update(id: string, patch: RolePatch): Promise<RoleRow | undefined> {
    const [row] = await this.db.current.update(roles).set(patch).where(eq(roles.id, id)).returning();
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.db.current.delete(roles).where(eq(roles.id, id));
  }

  /** Permission keys of each role, keyed by role ID. */
  async permissionsByRole(roleIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>(roleIds.map((id) => [id, []]));
    if (!roleIds.length) return result;
    const rows = await this.db.current
      .select({ roleId: rolePermissions.roleId, key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(inArray(rolePermissions.roleId, roleIds));
    for (const r of rows) result.get(r.roleId)?.push(r.key);
    return result;
  }

  async permissionKeys(roleId: string): Promise<string[]> {
    return (await this.permissionsByRole([roleId])).get(roleId) ?? [];
  }

  async replacePermissions(roleId: string, keys: string[], tenantId: string): Promise<void> {
    await this.db.current.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (keys.length) {
      await this.db.current.insert(rolePermissions).values(keys.map((permissionKey) => ({ tenantId, roleId, permissionKey })));
    }
  }

  async listPermissions(): Promise<{ key: string; module: string; description: string }[]> {
    return this.db.current.select().from(permissions).orderBy(asc(permissions.module), asc(permissions.key));
  }
}
