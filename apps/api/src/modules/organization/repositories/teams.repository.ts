import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DbService } from '../../../core/database/db.service';
import { decodeCursor } from '../../../core/http/pagination';
import { DivisionRow, divisions, TeamRow, teams } from '../organization.schema';

export type TeamValues = Partial<Pick<TeamRow, 'name' | 'divisionId' | 'salesManagerUserId' | 'teamLeaderUserId' | 'isActive'>>;
export type DivisionValues = Partial<Pick<DivisionRow, 'name' | 'gmUserId' | 'isActive'>>;

/** Teams and divisions are listed by name, then ID. */
export const byNameCursor = (r: { name: string; id: string }): unknown[] => [r.name, r.id];

@Injectable()
export class TeamsRepository {
  constructor(private readonly db: DbService) {}

  async listTeams(limit: number, cursor?: string): Promise<TeamRow[]> {
    return this.db.current
      .select()
      .from(teams)
      .where(cursor ? afterName(teams, cursor) : undefined)
      .orderBy(asc(teams.name), asc(teams.id))
      .limit(limit + 1);
  }

  async findTeam(id: string): Promise<TeamRow | undefined> {
    const [row] = await this.db.current.select().from(teams).where(eq(teams.id, id)).limit(1);
    return row;
  }

  async createTeam(values: TeamValues & { name: string }, tenantId: string): Promise<TeamRow> {
    const [row] = await this.db.current.insert(teams).values({ ...values, tenantId }).returning();
    return row!;
  }

  async updateTeam(id: string, values: TeamValues, expectedVersion?: string): Promise<TeamRow | undefined> {
    const [row] = await this.db.current
      .update(teams)
      .set(values)
      .where(and(eq(teams.id, id), expectedVersion ? eq(teams.updatedAt, expectedVersion) : undefined))
      .returning();
    return row;
  }

  async deleteTeam(id: string): Promise<boolean> {
    return (await this.db.current.delete(teams).where(eq(teams.id, id)).returning({ id: teams.id })).length === 1;
  }

  async listDivisions(limit: number, cursor?: string): Promise<DivisionRow[]> {
    return this.db.current
      .select()
      .from(divisions)
      .where(cursor ? afterName(divisions, cursor) : undefined)
      .orderBy(asc(divisions.name), asc(divisions.id))
      .limit(limit + 1);
  }

  async findDivision(id: string): Promise<DivisionRow | undefined> {
    const [row] = await this.db.current.select().from(divisions).where(eq(divisions.id, id)).limit(1);
    return row;
  }

  async createDivision(values: DivisionValues & { name: string }, tenantId: string): Promise<DivisionRow> {
    const [row] = await this.db.current.insert(divisions).values({ ...values, tenantId }).returning();
    return row!;
  }

  async updateDivision(id: string, values: DivisionValues, expectedVersion?: string): Promise<DivisionRow | undefined> {
    const [row] = await this.db.current
      .update(divisions)
      .set(values)
      .where(and(eq(divisions.id, id), expectedVersion ? eq(divisions.updatedAt, expectedVersion) : undefined))
      .returning();
    return row;
  }

  async deleteDivision(id: string): Promise<boolean> {
    return (await this.db.current.delete(divisions).where(eq(divisions.id, id)).returning({ id: divisions.id })).length === 1;
  }
}

function afterName(table: typeof teams | typeof divisions, cursor: string) {
  const [name, id] = decodeCursor(cursor, 2) as [string, string];
  return sql`(${table.name}, ${table.id}) > (${name}, ${id}::uuid)`;
}
