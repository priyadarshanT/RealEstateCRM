import { Injectable } from '@nestjs/common';
import { AuditService } from '../../core/audit/audit.service';
import { DbService } from '../../core/database/db.service';
import { Problems } from '../../core/errors/problem';
import { versionConflict } from '../../core/http/etag';
import { Page, toPage } from '../../core/http/pagination';
import { DivisionDto, DivisionInputDto, TeamDto, TeamInputDto } from './dto/team.dto';
import { OrgErrors, pgCode, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from './organization.errors';
import { DivisionRow, TeamRow } from './organization.schema';
import { byNameCursor, DivisionValues, TeamsRepository, TeamValues } from './repositories/teams.repository';

const TEAM_FIELDS = ['name', 'divisionId', 'salesManagerUserId', 'teamLeaderUserId', 'isActive'] as const;
const DIVISION_FIELDS = ['name', 'gmUserId', 'isActive'] as const;

/** Team menu → Manage team: divisions and teams (SRS §4.4–4.5). */
@Injectable()
export class TeamsService {
  constructor(
    private readonly repo: TeamsRepository,
    private readonly audit: AuditService,
    private readonly db: DbService,
  ) {}

  async listTeams(limit: number, cursor?: string): Promise<Page<TeamDto>> {
    return toPage(await this.repo.listTeams(limit, cursor), limit, byNameCursor, TeamDto.from);
  }

  async getTeam(id: string): Promise<TeamRow> {
    const team = await this.repo.findTeam(id);
    if (!team) throw Problems.notFound();
    return team;
  }

  async createTeam(body: TeamInputDto): Promise<TeamRow> {
    if (!body.name) throw Problems.validation([{ field: 'name', message: 'name is required' }]);
    const values = { ...pick(body, TEAM_FIELDS), name: body.name };
    const team = await this.repo.createTeam(values, this.db.currentTenantId!).catch(rethrow('Team'));
    await this.audit.record('create', 'teams', team.id, created(pick(team, TEAM_FIELDS)));
    return team;
  }

  async updateTeam(id: string, body: TeamInputDto, expectedVersion?: string): Promise<TeamRow> {
    const before = await this.getTeam(id);
    const values: TeamValues = pick(body, TEAM_FIELDS);
    if (!Object.keys(values).length) return before;
    const after = await this.repo.updateTeam(id, values, expectedVersion).catch(rethrow('Team'));
    if (!after) throw versionConflict();
    await this.audit.recordUpdate('teams', id, pick(before, TEAM_FIELDS), pick(after, TEAM_FIELDS));
    return after;
  }

  async deleteTeam(id: string): Promise<void> {
    const team = await this.getTeam(id);
    await this.repo.deleteTeam(id).catch(rethrow('Team'));
    await this.audit.record('delete', 'teams', id, { name: [team.name, null] });
  }

  async listDivisions(limit: number, cursor?: string): Promise<Page<DivisionDto>> {
    return toPage(await this.repo.listDivisions(limit, cursor), limit, byNameCursor, DivisionDto.from);
  }

  async getDivision(id: string): Promise<DivisionRow> {
    const division = await this.repo.findDivision(id);
    if (!division) throw Problems.notFound();
    return division;
  }

  async createDivision(body: DivisionInputDto): Promise<DivisionRow> {
    if (!body.name) throw Problems.validation([{ field: 'name', message: 'name is required' }]);
    const values = { ...pick(body, DIVISION_FIELDS), name: body.name };
    const division = await this.repo.createDivision(values, this.db.currentTenantId!).catch(rethrow('Division'));
    await this.audit.record('create', 'divisions', division.id, created(pick(division, DIVISION_FIELDS)));
    return division;
  }

  async updateDivision(id: string, body: DivisionInputDto, expectedVersion?: string): Promise<DivisionRow> {
    const before = await this.getDivision(id);
    const values: DivisionValues = pick(body, DIVISION_FIELDS);
    if (!Object.keys(values).length) return before;
    const after = await this.repo.updateDivision(id, values, expectedVersion).catch(rethrow('Division'));
    if (!after) throw versionConflict();
    await this.audit.recordUpdate('divisions', id, pick(before, DIVISION_FIELDS), pick(after, DIVISION_FIELDS));
    return after;
  }

  async deleteDivision(id: string): Promise<void> {
    const division = await this.getDivision(id);
    await this.repo.deleteDivision(id).catch(rethrow('Division'));
    await this.audit.record('delete', 'divisions', id, { name: [division.name, null] });
  }
}

/** Only the fields present (not undefined) in the source. */
function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Partial<Pick<T, K>> {
  return Object.fromEntries(keys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]])) as Partial<Pick<T, K>>;
}

function created(values: object): Record<string, [null, unknown]> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, [null, v]]));
}

/** Duplicate name → 409; a linked user or division that doesn't exist, or a record still in use → 409/422. */
function rethrow(what: string) {
  return (err: unknown): never => {
    const code = pgCode(err);
    if (code === PG_UNIQUE_VIOLATION) throw OrgErrors.nameTaken(what);
    if (code === PG_FOREIGN_KEY_VIOLATION) {
      const message = (err as { cause?: { message?: string } }).cause?.message ?? '';
      // Deleting a row that others still reference vs. linking to a row that doesn't exist.
      if (/is still referenced/.test(message) || /update or delete/.test(message)) throw OrgErrors.inUse(what);
      throw Problems.validation([{ field: 'id', message: 'a linked user or division does not exist' }]);
    }
    throw err;
  };
}
