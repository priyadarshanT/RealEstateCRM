import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, isNull, or, sql, SQL } from 'drizzle-orm';
import { DbService } from '../../../core/database/db.service';
import { decodeCursor } from '../../../core/http/pagination';
import { roles, UserRow, users } from '../organization.schema';

export interface UserWithRole {
  user: UserRow;
  roleKey: string;
  dataScope: 'own' | 'team' | 'division' | 'company';
}

export interface UserFilter {
  status?: UserRow['status'];
  roleId?: string;
  teamId?: string;
  q?: string;
  cursor?: string;
  limit: number;
}

export type UserInsert = Pick<UserRow, 'email' | 'fullName' | 'roleId'> &
  Partial<Pick<UserRow, 'phone' | 'teamId' | 'languages' | 'location'>>;

export type UserPatch = Partial<
  Pick<UserRow, 'email' | 'fullName' | 'phone' | 'roleId' | 'teamId' | 'languages' | 'location' | 'timezone' | 'status' | 'receivesLeads' | 'authSubject' | 'lastLoginAt'>
>;

/** Users list order: name, then ID (stable for cursor paging). */
export const userCursor = (u: UserRow): unknown[] => [u.fullName, u.id];

@Injectable()
export class UsersRepository {
  constructor(private readonly db: DbService) {}

  async findById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db.current.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  }

  async findBySubject(subject: string): Promise<UserWithRole | undefined> {
    const [row] = await this.db.current
      .select({ user: users, roleKey: roles.key, dataScope: roles.dataScope })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.authSubject, subject))
      .limit(1);
    return row;
  }

  /** First login after an invite: link the login provider's subject to the user with that email. */
  async linkSubjectByEmail(subject: string, email: string): Promise<boolean> {
    const linked = await this.db.current
      .update(users)
      .set({ authSubject: subject })
      .where(and(sql`${users.email} = ${email}::citext`, isNull(users.authSubject)))
      .returning({ id: users.id });
    return linked.length === 1;
  }

  async list(filter: UserFilter): Promise<UserRow[]> {
    const where: (SQL | undefined)[] = [
      filter.status ? eq(users.status, filter.status) : undefined,
      filter.roleId ? eq(users.roleId, filter.roleId) : undefined,
      filter.teamId ? eq(users.teamId, filter.teamId) : undefined,
      filter.q ? or(ilike(users.fullName, `%${escapeLike(filter.q)}%`), ilike(users.email, `%${escapeLike(filter.q)}%`)) : undefined,
    ];
    if (filter.cursor) {
      const [name, id] = decodeCursor(filter.cursor, 2) as [string, string];
      where.push(sql`(${users.fullName}, ${users.id}) > (${name}, ${id}::uuid)`);
    }
    return this.db.current
      .select()
      .from(users)
      .where(and(...where))
      .orderBy(asc(users.fullName), asc(users.id))
      .limit(filter.limit + 1);
  }

  /** Active users of the current tenant (row-level security), name and team only, by name. */
  async listActiveNames(): Promise<Pick<UserRow, 'id' | 'fullName' | 'teamId'>[]> {
    return this.db.current
      .select({ id: users.id, fullName: users.fullName, teamId: users.teamId })
      .from(users)
      .where(eq(users.status, 'active'))
      .orderBy(asc(users.fullName), asc(users.id));
  }

  async emailExists(email: string, exceptId?: string): Promise<boolean> {
    const rows = await this.db.current
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.email} = ${email}::citext`)
      .limit(2);
    return rows.some((r) => r.id !== exceptId);
  }

  async create(values: UserInsert, tenantId: string): Promise<UserRow> {
    const [row] = await this.db.current.insert(users).values({ ...values, tenantId }).returning();
    return row!;
  }

  /** Updates when `expectedVersion` (updated_at) still matches; undefined when the row is missing or changed. */
  async update(id: string, patch: UserPatch, expectedVersion?: string): Promise<UserRow | undefined> {
    const [row] = await this.db.current
      .update(users)
      .set(patch)
      .where(and(eq(users.id, id), expectedVersion ? eq(users.updatedAt, expectedVersion) : undefined))
      .returning();
    return row;
  }

  async countWithRole(roleId: string): Promise<number> {
    const [row] = await this.db.current.select({ n: count() }).from(users).where(eq(users.roleId, roleId));
    return row?.n ?? 0;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
