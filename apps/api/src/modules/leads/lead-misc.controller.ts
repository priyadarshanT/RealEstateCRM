import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { and, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { Problems } from '../../core/errors/problem';
import { OrganizationDirectory } from '../organization/directory.service';
import { SavedFilterDto, SavedFilterInputDto, SavedFilterList, SavedFilterQuery, SearchQuery, SearchResultDto, WorkloadDto } from './dto/lead.dto';
import { LeadScope } from './lead-scope';
import { leadAssignments, leads } from './leads.schema';
import { SavedFiltersService } from './saved-filters.service';

@ApiTags('Leads')
@ApiBearerAuth('bearer')
@Controller('saved-filters')
export class SavedFiltersController {
  constructor(private readonly filters: SavedFiltersService) {}

  @Get()
  @ApiOperation({ operationId: 'listSavedFilters', summary: 'List saved filters' })
  @ApiOkResponse({ type: SavedFilterList })
  async list(@CurrentPrincipal() p: Principal, @Query() query: SavedFilterQuery): Promise<SavedFilterList> {
    return { data: await this.filters.list(p, query.entity) };
  }

  @Post()
  @ApiOperation({ operationId: 'createSavedFilter', summary: 'Save a filter' })
  @ApiCreatedResponse({ type: SavedFilterDto })
  create(@CurrentPrincipal() p: Principal, @Body() body: SavedFilterInputDto): Promise<SavedFilterDto> {
    return this.filters.create(p, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteSavedFilter', summary: 'Delete a saved filter' })
  @ApiNoContentResponse({ description: 'Done' })
  delete(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.filters.delete(p, id);
  }
}

/** Global search (SRS §1.3) and a user's lead workload (Team → Manage users). */
@ApiBearerAuth('bearer')
@Controller()
export class LeadLookupController {
  constructor(
    private readonly db: DbService,
    private readonly scope: LeadScope,
    private readonly directory: OrganizationDirectory,
  ) {}

  @Get('search')
  @ApiTags('Session')
  @ApiOperation({ operationId: 'globalSearch', summary: 'Global search' })
  @ApiOkResponse({ type: SearchResultDto })
  async search(@CurrentPrincipal() p: Principal, @Query() query: SearchQuery): Promise<SearchResultDto> {
    const limit = Math.min(query.limit, 50);
    const q = query.q.trim();
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = q.replace(/[^\d+]/g, '');
    const leadRows = p.permissions.has('leads.view')
      ? await this.db.current
          .select({ id: leads.id, name: leads.fullName })
          .from(leads)
          .where(
            and(
              isNull(leads.deletedAt),
              await this.scope.visible(p),
              sql`(${leads.fullName} ILIKE ${like} OR ${leads.email} ILIKE ${like}${digits.length >= 3 ? sql` OR ${leads.phonePrimary} LIKE ${`%${digits}%`} OR ${leads.phoneAlternate} LIKE ${`%${digits}%`}` : sql``})`,
            ),
          )
          .orderBy(sql`${leads.score} DESC`, leads.fullName)
          .limit(limit)
      : [];
    const users = p.permissions.has('users.manage') ? await this.directory.searchUsers(q, limit) : [];
    // Projects and units are searched once the projects module exists (Phase 3).
    return { leads: leadRows, projects: [], units: [], users };
  }

  @Get('users/:id/workload')
  @ApiTags('Organization')
  @RequirePermission('users.manage')
  @ApiOperation({ operationId: 'getUserWorkload', summary: "A user's lead workload" })
  @ApiOkResponse({ type: WorkloadDto })
  async workload(@Param('id', ParseUUIDPipe) id: string): Promise<WorkloadDto> {
    if (!(await this.directory.user(id))) throw Problems.notFound();
    const since = new Date(Date.now() - 30 * 86_400_000);
    const open = and(eq(leads.ownerUserId, id), eq(leads.stageCategory, 'open'), isNull(leads.deletedAt));
    const [counts] = await this.db.current
      .select({
        openLeads: sql<number>`count(*)::int`,
        overdue: sql<number>`count(*) FILTER (WHERE ${leads.nextFollowUpAt} < now())::int`,
      })
      .from(leads)
      .where(open);
    const [missed] = await this.db.current
      .select({ n: sql<number>`count(*)::int` })
      .from(leadAssignments)
      .where(and(eq(leadAssignments.fromUserId, id), sql`${leadAssignments.method} IN ('no_response', 'admin_fallback')`, gte(leadAssignments.changedAt, since)));
    const [response] = await this.db.current
      .select({ minutes: sql<string | null>`avg(extract(epoch FROM ${leads.firstResponseAt} - ${leads.assignedAt}) / 60)` })
      .from(leads)
      .where(and(eq(leads.ownerUserId, id), isNotNull(leads.firstResponseAt), gte(leads.assignedAt, since), lt(leads.assignedAt, new Date())));
    return {
      openLeads: counts?.openLeads ?? 0,
      overdue: counts?.overdue ?? 0,
      missedLast30d: missed?.n ?? 0,
      avgResponseMinutes: response?.minutes === null || response?.minutes === undefined ? null : Math.round(Number(response.minutes) * 10) / 10,
    };
  }
}
