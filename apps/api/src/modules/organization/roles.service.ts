import { Injectable } from '@nestjs/common';
import { AuditService } from '../../core/audit/audit.service';
import { DbService } from '../../core/database/db.service';
import { Problems } from '../../core/errors/problem';
import { CreateRoleDto, PermissionDto, RoleDto, UpdateRoleDto } from './dto/role.dto';
import { OrgErrors, pgCode, PG_UNIQUE_VIOLATION } from './organization.errors';
import { RolePatch, RolesRepository } from './repositories/roles.repository';
import { UsersRepository } from './repositories/users.repository';

/** Team menu → Roles and permissions (SRS §4.6–4.7). */
@Injectable()
export class RolesService {
  constructor(
    private readonly roles: RolesRepository,
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
    private readonly db: DbService,
  ) {}

  async list(): Promise<RoleDto[]> {
    const rows = await this.roles.list();
    const perms = await this.roles.permissionsByRole(rows.map((r) => r.id));
    return rows.map((r) => RoleDto.from(r, perms.get(r.id) ?? []));
  }

  async listPermissions(): Promise<PermissionDto[]> {
    return this.roles.listPermissions();
  }

  async create(body: CreateRoleDto): Promise<RoleDto> {
    await this.assertKnownPermissions(body.permissions);
    if (await this.roles.keyExists(body.key)) throw OrgErrors.roleKeyTaken();
    const tenantId = this.db.currentTenantId!;
    const role = await this.roles.create({ key: body.key, name: body.name, dataScope: body.dataScope }, tenantId).catch(rethrowKeyTaken);
    await this.roles.replacePermissions(role.id, body.permissions, tenantId);
    await this.audit.record('permission_change', 'roles', role.id, {
      key: [null, role.key],
      dataScope: [null, role.dataScope],
      permissions: [null, [...body.permissions].sort()],
    });
    return RoleDto.from(role, body.permissions);
  }

  async update(id: string, body: UpdateRoleDto): Promise<RoleDto> {
    const before = await this.roles.findById(id);
    if (!before) throw Problems.notFound();
    if (before.isSystem && body.key !== undefined && body.key !== before.key) {
      throw OrgErrors.systemRole('The key of a built-in role cannot be changed.');
    }
    const oldPermissions = (await this.roles.permissionKeys(id)).sort();

    const patch: RolePatch = {};
    if (body.key !== undefined && body.key !== before.key) {
      if (await this.roles.keyExists(body.key)) throw OrgErrors.roleKeyTaken();
      patch.key = body.key;
    }
    if (body.name !== undefined) patch.name = body.name;
    if (body.dataScope !== undefined) patch.dataScope = body.dataScope;
    const after = Object.keys(patch).length ? await this.roles.update(id, patch).catch(rethrowKeyTaken) : before;
    if (!after) throw Problems.notFound();

    let permissions = oldPermissions;
    if (body.permissions) {
      await this.assertKnownPermissions(body.permissions);
      permissions = [...body.permissions].sort();
      if (permissions.join() !== oldPermissions.join()) await this.roles.replacePermissions(id, permissions, this.db.currentTenantId!);
    }

    await this.audit.recordUpdate(
      'roles',
      id,
      { key: before.key, name: before.name, dataScope: before.dataScope, permissions: oldPermissions },
      { key: after.key, name: after.name, dataScope: after.dataScope, permissions },
      'permission_change',
    );
    return RoleDto.from(after, permissions);
  }

  async delete(id: string): Promise<void> {
    const role = await this.roles.findById(id);
    if (!role) throw Problems.notFound();
    if (role.isSystem) throw OrgErrors.systemRole('Built-in roles cannot be deleted.');
    const inUse = await this.users.countWithRole(id);
    if (inUse > 0) throw OrgErrors.roleInUse(inUse);
    const permissions = (await this.roles.permissionKeys(id)).sort();
    await this.roles.delete(id);
    await this.audit.record('delete', 'roles', id, { key: [role.key, null], permissions: [permissions, null] });
  }

  private async assertKnownPermissions(keys: string[]): Promise<void> {
    const known = new Set((await this.roles.listPermissions()).map((p) => p.key));
    const unknown = keys.filter((k) => !known.has(k));
    if (unknown.length) throw Problems.validation(unknown.map((k) => ({ field: 'permissions', message: `unknown permission: ${k}` })));
  }
}

function rethrowKeyTaken(err: unknown): never {
  if (pgCode(err) === PG_UNIQUE_VIOLATION) throw OrgErrors.roleKeyTaken();
  throw err;
}
