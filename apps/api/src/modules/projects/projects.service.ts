import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gte, ilike, inArray, lt, or, sql, SQL } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { DbService } from '../../core/database/db.service';
import { isStillReferenced, pgCode, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from '../../core/errors/pg';
import { ProblemException, Problems } from '../../core/errors/problem';
import { versionConflict } from '../../core/http/etag';
import { dayAfter, dayStart, zonedDayAfter, zonedDayStart } from '../../core/http/dates';
import { decodeCursor, encodeCursor, Page, toPage } from '../../core/http/pagination';
import { RequestContext } from '../../core/http/request-context';
import { FilesService } from '../../core/files/files.service';
import { normalizePhone } from '../leads/lead-intake.service';
import { OrganizationService } from '../organization/organization.service';
import { CustomFieldsService } from './custom-fields';
import {
  BuildingInputDto,
  DeveloperDto,
  DeveloperInputDto,
  InventoryDto,
  ProjectDto,
  ProjectInputDto,
  ProjectListQuery,
  CategoryCountList,
  ProjectPage,
  StartingPriceDto,
} from './dto/projects.dto';
import { BuildingRow, buildings, DeveloperRow, developers, PROJECT_CATEGORIES, ProjectRow, projects, units } from './projects.schema';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Developers, projects and buildings (SRS §6.1): every user can browse them; only `projects.manage` changes them.
 * Each project shows its inventory (available, on hold, booked, sold).
 */
@Injectable()
export class ProjectsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly organization: OrganizationService,
    private readonly customFields: CustomFieldsService,
  ) {}

  onModuleInit(): void {
    // Project files (brochures, images): visible to everyone in the company, changed by projects.manage.
    this.files.registerAccess('project', {
      canView: async (id) => !!(await this.findProject(id)),
      canEdit: async (id) => !!(await this.findProject(id)) && !!RequestContext.get().principal?.permissions.has('projects.manage'),
    });
  }

  // ---------------------------------------------------------------- developers
  async listDevelopers(limit: number, cursor?: string): Promise<Page<DeveloperDto>> {
    const after = cursor ? (([name, id]) => sql`(${developers.name}, ${developers.id}) > (${name}, ${id}::uuid)`)(decodeCursor(cursor, 2) as [string, string]) : undefined;
    const rows = await this.db.current.select().from(developers).where(after).orderBy(asc(developers.name), asc(developers.id)).limit(limit + 1);
    return toPage(rows, limit, (r) => [r.name, r.id], DeveloperDto.from);
  }

  async getDeveloper(id: string): Promise<DeveloperRow> {
    const [row] = await this.db.current.select().from(developers).where(eq(developers.id, id)).limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }

  async createDeveloper(body: DeveloperInputDto): Promise<DeveloperRow> {
    if (!body.name?.trim()) throw Problems.validation([{ field: 'name', message: 'name is required' }]);
    const [row] = await this.db.current
      .insert(developers)
      .values({ tenantId: this.db.currentTenantId!, name: body.name.trim(), ...developerFields(body) })
      .returning()
      .catch(rethrow('developer'));
    await this.audit.record('create', 'developers', row!.id, { name: [null, row!.name] });
    return row!;
  }

  async updateDeveloper(id: string, body: DeveloperInputDto, expectedVersion?: string): Promise<DeveloperRow> {
    const before = await this.getDeveloper(id);
    const [after] = await this.db.current
      .update(developers)
      .set({ ...(body.name !== undefined ? { name: body.name.trim() } : {}), ...developerFields(body) })
      .where(and(eq(developers.id, id), expectedVersion ? eq(developers.updatedAt, expectedVersion) : undefined))
      .returning()
      .catch(rethrow('developer'));
    if (!after) throw versionConflict();
    await this.audit.recordUpdate('developers', id, developerView(before), developerView(after));
    return after;
  }

  async deleteDeveloper(id: string): Promise<void> {
    const row = await this.getDeveloper(id);
    await this.db.current.delete(developers).where(eq(developers.id, id)).catch(rethrow('developer'));
    await this.audit.record('delete', 'developers', id, { name: [row.name, null] });
  }

  // ---------------------------------------------------------------- projects
  /**
   * Project list (Project page): search, developer, category tab, status, Assigned To and a date range on
   * Created, Updated or Handover date (company time zone, end date included); `total` for Show Entries.
   */
  async listProjects(q: ProjectListQuery): Promise<ProjectPage> {
    const where = and(...(await this.conditions(q)), q.category ? eq(projects.category, q.category) : undefined);
    const offset = q.cursor ? Number(decodeCursor(q.cursor, 1)[0]) : 0;
    const rows = await this.db.current.select().from(projects).where(where).orderBy(asc(projects.name), asc(projects.id)).limit(q.limit + 1).offset(offset);
    const kept = rows.slice(0, q.limit);
    const [inventory, prices] = await Promise.all([this.inventory(kept.map((r) => r.id)), this.startingPrices(kept.map((r) => r.id))]);
    const hasMore = rows.length > q.limit;
    const total = q.total ? (await this.db.current.select({ n: sql<number>`count(*)::int` }).from(projects).where(where))[0]?.n : undefined;
    return {
      data: kept.map((r) => ProjectDto.from(r, inventory.get(r.id) ?? emptyInventory(), prices.get(r.id) ?? null)),
      page: { nextCursor: hasMore ? encodeCursor([offset + q.limit]) : null, hasMore, ...(total !== undefined ? { total } : {}) },
    };
  }

  /** Category tabs with counts (zeros included); they follow the same search, dates and filters as the list. */
  async categoryCounts(q: ProjectListQuery): Promise<CategoryCountList> {
    const rows = await this.db.current
      .select({ category: projects.category, n: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(...(await this.conditions(q))))
      .groupBy(projects.category);
    const of = new Map(rows.map((r) => [r.category, r.n]));
    const data = PROJECT_CATEGORIES.map((category) => ({ category, count: of.get(category) ?? 0 }));
    return { data, total: data.reduce((n, c) => n + c.count, 0) };
  }

  /** One page of projects for an export (worker): the filters, or the chosen project IDs. */
  async exportRows(q: ProjectListQuery & { projectIds?: string[] }, limit: number, offset: number): Promise<ProjectDto[]> {
    const where = and(
      ...(await this.conditions(q)),
      q.category ? eq(projects.category, q.category) : undefined,
      q.projectIds ? inArray(projects.id, q.projectIds.length ? q.projectIds : ['00000000-0000-0000-0000-000000000000']) : undefined,
    );
    const rows = await this.db.current.select().from(projects).where(where).orderBy(asc(projects.name), asc(projects.id)).limit(limit).offset(offset);
    const [inventory, prices] = await Promise.all([this.inventory(rows.map((r) => r.id)), this.startingPrices(rows.map((r) => r.id))]);
    return rows.map((r) => ProjectDto.from(r, inventory.get(r.id) ?? emptyInventory(), prices.get(r.id) ?? null));
  }

  private async conditions(q: ProjectListQuery): Promise<(SQL | undefined)[]> {
    const c: (SQL | undefined)[] = [
      q.developerId ? eq(projects.developerId, q.developerId) : undefined,
      q.isActive !== undefined ? eq(projects.isActive, q.isActive) : undefined,
      q.constructionStatus ? eq(projects.constructionStatus, q.constructionStatus) : undefined,
      q.assignedUserId ? eq(projects.assignedUserId, q.assignedUserId) : undefined,
    ];
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      c.push(or(ilike(projects.name, like), ilike(projects.community, like), ilike(projects.city, like)));
    }
    if (q.dateFrom || q.dateTo) {
      if (q.dateField === 'handover') {
        // A date only: compared as calendar days.
        if (q.dateFrom) c.push(gte(projects.handoverDate, q.dateFrom));
        if (q.dateTo) c.push(sql`${projects.handoverDate} <= ${q.dateTo}`);
      } else {
        const tz = (await this.organization.getProfile(this.db.currentTenantId!)).timezone ?? 'Asia/Dubai';
        const column = q.dateField === 'updated' ? projects.updatedAt : projects.createdAt;
        if (q.dateFrom) c.push(sql`${column} >= ${zonedDayStart(q.dateFrom, tz)}`);
        if (q.dateTo) c.push(sql`${column} < ${zonedDayAfter(q.dateTo, tz)}`);
      }
    }
    return c;
  }

  /** Starting Price: the lowest price of an available unit of each project. */
  private async startingPrices(projectIds: string[]): Promise<Map<string, StartingPriceDto>> {
    if (!projectIds.length) return new Map();
    const rows = await this.db.current
      .selectDistinctOn([units.projectId], { projectId: units.projectId, price: units.price, currency: units.currency })
      .from(units)
      .where(and(inArray(units.projectId, projectIds), eq(units.status, 'available')))
      .orderBy(units.projectId, asc(units.price));
    return new Map(rows.map((r) => [r.projectId, { amount: Number(r.price).toFixed(2), currency: r.currency }]));
  }

  async getProject(id: string): Promise<ProjectRow> {
    const row = await this.findProject(id);
    if (!row) throw Problems.notFound();
    return row;
  }

  async projectDto(row: ProjectRow): Promise<ProjectDto> {
    return ProjectDto.from(row, (await this.inventory([row.id])).get(row.id) ?? emptyInventory(), (await this.startingPrices([row.id])).get(row.id) ?? null);
  }

  /** Project IDs by name, ignoring case (lead migration maps a "Project" column). */
  async idsByName(): Promise<Map<string, string>> {
    const rows = await this.db.current.select({ id: projects.id, name: projects.name }).from(projects);
    return new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.id]));
  }

  /** Developer names by ID (project exports). */
  async developerNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.db.current.select({ id: developers.id, name: developers.name }).from(developers).where(inArray(developers.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Project names by ID (labels in other modules, e.g. reports). */
  async names(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.db.current.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async createProject(body: ProjectInputDto): Promise<ProjectRow> {
    const missing = (['developerId', 'name'] as const).filter((f) => !body[f]);
    if (missing.length) throw Problems.validation(missing.map((field) => ({ field, message: `${field} is required` })));
    await this.getDeveloper(body.developerId!).catch(() => {
      throw Problems.validation([{ field: 'developerId', message: 'developer not found' }]);
    });
    const customValues = await this.customFields.check(body.customValues ?? {}, null);
    const [row] = await this.db.current
      .insert(projects)
      .values({ tenantId: this.db.currentTenantId!, developerId: body.developerId!, name: body.name!.trim(), ...projectFields(body), customValues })
      .returning()
      .catch(rethrow('project'));
    await this.audit.record('create', 'projects', row!.id, { name: [null, row!.name], developerId: [null, row!.developerId] });
    return row!;
  }

  async updateProject(id: string, body: ProjectInputDto, expectedVersion?: string): Promise<ProjectRow> {
    const before = await this.getProject(id);
    if (body.developerId && body.developerId !== before.developerId) {
      await this.getDeveloper(body.developerId).catch(() => {
        throw Problems.validation([{ field: 'developerId', message: 'developer not found' }]);
      });
    }
    const customValues = body.customValues !== undefined ? await this.customFields.check(body.customValues, before.customValues ?? {}) : undefined;
    const [after] = await this.db.current
      .update(projects)
      .set({ ...(body.developerId ? { developerId: body.developerId } : {}), ...(body.name !== undefined ? { name: body.name.trim() } : {}), ...projectFields(body), ...(customValues ? { customValues } : {}) })
      .where(and(eq(projects.id, id), expectedVersion ? eq(projects.updatedAt, expectedVersion) : undefined))
      .returning()
      .catch(rethrow('project'));
    if (!after) throw versionConflict();
    await this.audit.recordUpdate('projects', id, projectView(before), projectView(after));
    return after;
  }

  /** A project with units, leads or deals cannot be deleted; switch it off (isActive) instead. */
  async deleteProject(id: string): Promise<void> {
    const row = await this.getProject(id);
    await this.db.current.delete(buildings).where(eq(buildings.projectId, id)).catch(rethrow('project'));
    await this.db.current.delete(projects).where(eq(projects.id, id)).catch(rethrow('project'));
    await this.audit.record('delete', 'projects', id, { name: [row.name, null] });
  }

  // ---------------------------------------------------------------- buildings
  async listBuildings(projectId: string): Promise<BuildingRow[]> {
    await this.getProject(projectId);
    return this.db.current.select().from(buildings).where(eq(buildings.projectId, projectId)).orderBy(asc(buildings.name));
  }

  async createBuilding(projectId: string, body: BuildingInputDto): Promise<BuildingRow> {
    await this.getProject(projectId);
    if (!body.name?.trim()) throw Problems.validation([{ field: 'name', message: 'name is required' }]);
    const [row] = await this.db.current
      .insert(buildings)
      .values({ tenantId: this.db.currentTenantId!, projectId, name: body.name.trim(), floors: body.floors ?? null, handoverDate: body.handoverDate ?? null })
      .returning()
      .catch(rethrow('building'));
    await this.audit.record('create', 'buildings', row!.id, { name: [null, row!.name], projectId: [null, projectId] });
    return row!;
  }

  async updateBuilding(id: string, body: BuildingInputDto): Promise<BuildingRow> {
    const before = await this.getBuilding(id);
    const [after] = await this.db.current
      .update(buildings)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.floors !== undefined ? { floors: body.floors } : {}),
        ...(body.handoverDate !== undefined ? { handoverDate: body.handoverDate } : {}),
      })
      .where(eq(buildings.id, id))
      .returning()
      .catch(rethrow('building'));
    await this.audit.recordUpdate('buildings', id, { name: before.name, floors: before.floors, handoverDate: before.handoverDate }, { name: after!.name, floors: after!.floors, handoverDate: after!.handoverDate });
    return after!;
  }

  async getBuilding(id: string): Promise<BuildingRow> {
    const [row] = await this.db.current.select().from(buildings).where(eq(buildings.id, id)).limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }

  private async findProject(id: string): Promise<ProjectRow | undefined> {
    const [row] = await this.db.current.select().from(projects).where(eq(projects.id, id)).limit(1);
    return row;
  }

  private async inventory(projectIds: string[]): Promise<Map<string, InventoryDto>> {
    if (!projectIds.length) return new Map();
    const rows = await this.db.current
      .select({ projectId: units.projectId, status: units.status, n: sql<number>`count(*)::int` })
      .from(units)
      .where(inArray(units.projectId, projectIds))
      .groupBy(units.projectId, units.status);
    const out = new Map<string, InventoryDto>();
    for (const r of rows) {
      const inv = out.get(r.projectId) ?? emptyInventory();
      inv[r.status === 'on_hold' ? 'onHold' : r.status] = r.n;
      out.set(r.projectId, inv);
    }
    return out;
  }
}

function emptyInventory(): InventoryDto {
  return { available: 0, onHold: 0, booked: 0, sold: 0 };
}

function developerFields(body: DeveloperInputDto) {
  const errors: { field: string; message: string }[] = [];
  const email = body.email === undefined || body.email === null ? body.email : body.email.trim().toLowerCase();
  if (email && !EMAIL.test(email)) errors.push({ field: 'email', message: 'not a valid email' });
  const phone = body.phone === undefined || body.phone === null ? body.phone : normalizePhone(body.phone);
  if (body.phone && !phone) errors.push({ field: 'phone', message: 'use the international format, e.g. +971 4 123 4567' });
  if (errors.length) throw Problems.validation(errors);
  return {
    ...(body.trn !== undefined ? { trn: body.trn } : {}),
    ...(body.contactName !== undefined ? { contactName: body.contactName } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(body.address !== undefined ? { address: body.address } : {}),
    ...(body.website !== undefined ? { website: body.website } : {}),
  };
}

function projectFields(body: ProjectInputDto) {
  return {
    ...(body.community !== undefined ? { community: body.community } : {}),
    ...(body.city !== undefined ? { city: body.city } : {}),
    ...(body.address !== undefined ? { address: body.address } : {}),
    ...(body.latitude !== undefined ? { latitude: body.latitude === null ? null : String(body.latitude) } : {}),
    ...(body.longitude !== undefined ? { longitude: body.longitude === null ? null : String(body.longitude) } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.constructionStatus !== undefined ? { constructionStatus: body.constructionStatus } : {}),
    ...(body.handoverDate !== undefined ? { handoverDate: body.handoverDate } : {}),
    ...(body.paymentPlan !== undefined ? { paymentPlan: body.paymentPlan } : {}),
    ...(body.brochureFileId !== undefined ? { brochureFileId: body.brochureFileId } : {}),
    ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    ...(body.category !== undefined ? { category: body.category } : {}),
    ...(body.assignedUserId !== undefined ? { assignedUserId: body.assignedUserId } : {}),
  };
}

function developerView(d: DeveloperRow) {
  return { name: d.name, trn: d.trn, contactName: d.contactName, email: d.email, phone: d.phone, address: d.address, website: d.website };
}

function projectView(p: ProjectRow) {
  return { developerId: p.developerId, name: p.name, community: p.community, city: p.city, constructionStatus: p.constructionStatus, handoverDate: p.handoverDate, paymentPlan: p.paymentPlan, isActive: p.isActive, category: p.category, assignedUserId: p.assignedUserId, customValues: p.customValues };
}

/** Database refusals as API answers: duplicate names, records still in use, unknown files. */
export function rethrow(what: string) {
  return (err: unknown): never => {
    if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ProblemException(409, 'CONFLICT', 'Already exists', `A ${what} with this name already exists.`);
    if (isStillReferenced(err)) throw new ProblemException(409, 'CONFLICT', 'In use', `This ${what} is still used by other records.`);
    if (pgCode(err) === PG_FOREIGN_KEY_VIOLATION) throw Problems.validation([{ field: 'id', message: 'a linked record, user or file was not found' }]);
    throw err;
  };
}
