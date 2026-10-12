import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, or } from 'drizzle-orm';
import { DbService } from '../../core/database/db.service';
import { divisions, roles, teams, users } from './organization.schema';

export interface UserSummary {
  id: string;
  fullName: string;
  email: string;
  status: 'invited' | 'active' | 'inactive';
  receivesLeads: boolean;
  teamId: string | null;
  roleKey: string;
  languages: string[];
  location: string | null;
}

/**
 * Read-only view of people and the team hierarchy for other modules (leads scope, assignment, notifications).
 * Runs inside the caller's tenant transaction.
 */
@Injectable()
export class OrganizationDirectory {
  constructor(private readonly db: DbService) {}

  async users(ids: string[]): Promise<Map<string, UserSummary>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await this.select().where(inArray(users.id, unique));
    return new Map(rows.map((r) => [r.id, r]));
  }

  async user(id: string): Promise<UserSummary | undefined> {
    return (await this.users([id])).get(id);
  }

  /** Teams a user's records scope covers: the teams they lead or manage (team), or their divisions' teams (division). */
  async scopeTeamIds(userId: string, scope: 'team' | 'division'): Promise<string[]> {
    if (scope === 'team') {
      const rows = await this.db.current
        .select({ id: teams.id })
        .from(teams)
        .where(or(eq(teams.teamLeaderUserId, userId), eq(teams.salesManagerUserId, userId)));
      return rows.map((r) => r.id);
    }
    const rows = await this.db.current
      .select({ id: teams.id })
      .from(teams)
      .innerJoin(divisions, eq(divisions.id, teams.divisionId))
      .where(eq(divisions.gmUserId, userId));
    return rows.map((r) => r.id);
  }

  /** Active members of a team, in a stable order (for round-robin and the 10-minute rule). */
  async teamMembers(teamId: string): Promise<UserSummary[]> {
    return this.select().where(and(eq(users.teamId, teamId), eq(users.status, 'active'))).orderBy(asc(users.fullName), asc(users.id));
  }

  /** Active users with the built-in Admin role (fallback owner when a whole team misses a lead). */
  async admins(): Promise<UserSummary[]> {
    return this.select().where(and(eq(roles.key, 'admin'), eq(users.status, 'active'))).orderBy(asc(users.fullName), asc(users.id));
  }

  /** Global search: people by name or email. */
  async searchUsers(q: string, limit: number): Promise<{ id: string; name: string }[]> {
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await this.db.current
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(or(ilike(users.fullName, pattern), ilike(users.email, pattern)))
      .orderBy(asc(users.fullName))
      .limit(limit);
    return rows;
  }

  private select() {
    return this.db.current
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        status: users.status,
        receivesLeads: users.receivesLeads,
        teamId: users.teamId,
        roleKey: roles.key,
        languages: users.languages,
        location: users.location,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .$dynamic();
  }
}
