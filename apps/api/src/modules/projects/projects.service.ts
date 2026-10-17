import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { DbService } from '../../core/database/db.service';
import { isStillReferenced, pgCode, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from '../../core/errors/pg';
import { ProblemException, Problems } from '../../core/errors/problem';
import { versionConflict } from '../../core/http/etag';
import { decodeCursor, Page, toPage } from '../../core/http/pagination';
import { RequestContext } from '../../core/http/request-context';
import { FilesService } from '../../core/files/files.service';
import { normalizePhone } from '../leads/lead-intake.service';
import {
  BuildingInputDto,
  DeveloperDto,
  DeveloperInputDto,
  InventoryDto,
  ProjectDto,
  ProjectInputDto,
  ProjectListQuery,
} from './dto/projects.dto';
import { BuildingRow, buildings, DeveloperRow, developers, ProjectRow, projects, units } from './projects.schema';

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
  async listProjects(q: ProjectListQuery): Promise<Page<ProjectDto>> {
    const after = q.cursor ? (([name, id]) => sql`(${projects.name}, ${projects.id}) > (${name}, ${id}::uuid)`)(decodeCursor(q.cursor, 2) as [string, string]) : undefined;
    const rows = await this.db.current
      .select()
      .from(projects)
      .where(
        and(
          after,
          q.developerId ? eq(projects.developerId, q.developerId) : undefined,
          q.isActive !== undefined ? eq(projects.isActive, q.isActive) : undefined,
          q.q ? ilike(projects.name, `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
        ),
      )
      .orderBy(asc(projects.name), asc(projects.id))
      .limit(q.limit + 1);
    const inventory = await this.inventory(rows.slice(0, q.limit).map((r) => r.id));
    return toPage(rows, q.limit, (r) => [r.name, r.id], (r) => ProjectDto.from(r, inventory.get(r.id) ?? emptyInventory()));
  }

  async getProject(id: string): Promise<ProjectRow> {
    const row = await this.findProject(id);
    if (!row) throw Problems.notFound();
    return row;
  }

  async projectDto(row: ProjectRow): Promise<ProjectDto> {
    return ProjectDto.from(row, (await this.inventory([row.id])).get(row.id) ?? emptyInventory());
  }

  /** Project IDs by name, ignoring case (lead migration maps a "Project" column). */
  async idsByName(): Promise<Map<string, string>> {
    const rows = await this.db.current.select({ id: projects.id, name: projects.name }).from(projects);
    return new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.id]));
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
    const [row] = await this.db.current
      .insert(projects)
      .values({ tenantId: this.db.currentTenantId!, developerId: body.developerId!, name: body.name!.trim(), ...projectFields(body) })
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
    const [after] = await this.db.current
      .update(projects)
      .set({ ...(body.developerId ? { developerId: body.developerId } : {}), ...(body.name !== undefined ? { name: body.name.trim() } : {}), ...projectFields(body) })
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
  };
}

function developerView(d: DeveloperRow) {
  return { name: d.name, trn: d.trn, contactName: d.contactName, email: d.email, phone: d.phone, address: d.address, website: d.website };
}

function projectView(p: ProjectRow) {
  return { developerId: p.developerId, name: p.name, community: p.community, city: p.city, constructionStatus: p.constructionStatus, handoverDate: p.handoverDate, paymentPlan: p.paymentPlan, isActive: p.isActive };
}

/** Database refusals as API answers: duplicate names, records still in use, unknown files. */
export function rethrow(what: string) {
  return (err: unknown): never => {
    if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ProblemException(409, 'CONFLICT', 'Already exists', `A ${what} with this name already exists.`);
    if (isStillReferenced(err)) throw new ProblemException(409, 'CONFLICT', 'In use', `This ${what} is still used by other records.`);
    if (pgCode(err) === PG_FOREIGN_KEY_VIOLATION) throw Problems.validation([{ field: 'fileId', message: 'linked record or file not found' }]);
    throw err;
  };
}
