import { Injectable } from '@nestjs/common';
import { and, asc, eq, or } from 'drizzle-orm';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { ProblemException, Problems } from '../../core/errors/problem';
import { pgCode, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from '../../core/errors/pg';
import { OrganizationDirectory } from '../organization/directory.service';
import { SavedFilterDto, SavedFilterInputDto } from './dto/lead.dto';
import { SavedFilterRow, savedFilters } from './leads.schema';

/** Saved list filters and column choices, private or shared with a team (SRS §1.4). */
@Injectable()
export class SavedFiltersService {
  constructor(
    private readonly db: DbService,
    private readonly directory: OrganizationDirectory,
  ) {}

  async list(p: Principal, entity?: SavedFilterRow['entity']): Promise<SavedFilterDto[]> {
    const myTeam = (await this.directory.user(p.userId))?.teamId;
    const rows = await this.db.current
      .select()
      .from(savedFilters)
      .where(and(entity ? eq(savedFilters.entity, entity) : undefined, or(eq(savedFilters.ownerUserId, p.userId), myTeam ? eq(savedFilters.sharedTeamId, myTeam) : undefined)))
      .orderBy(asc(savedFilters.name));
    return rows.map(SavedFilterDto.from);
  }

  async create(p: Principal, body: SavedFilterInputDto): Promise<SavedFilterDto> {
    const [row] = await this.db.current
      .insert(savedFilters)
      .values({
        tenantId: p.tenantId,
        ownerUserId: p.userId,
        entity: body.entity,
        name: body.name,
        filters: body.filters,
        columns: body.columns ?? [],
        sort: body.sort ?? [],
        sharedTeamId: body.sharedTeamId ?? null,
      })
      .returning()
      .catch((err) => {
        if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ProblemException(409, 'CONFLICT', 'Name already used', 'You already have a saved filter with this name.');
        if (pgCode(err) === PG_FOREIGN_KEY_VIOLATION) throw Problems.validation([{ field: 'sharedTeamId', message: 'team not found' }]);
        throw err;
      });
    return SavedFilterDto.from(row!);
  }

  /** Only the owner deletes a saved filter. */
  async delete(p: Principal, id: string): Promise<void> {
    const deleted = await this.db.current
      .delete(savedFilters)
      .where(and(eq(savedFilters.id, id), eq(savedFilters.ownerUserId, p.userId)))
      .returning({ id: savedFilters.id });
    if (!deleted.length) throw Problems.notFound();
  }
}
