import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { DbService } from '../../core/database/db.service';
import { pgCode, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from '../../core/errors/pg';
import { ProblemException, Problems } from '../../core/errors/problem';
import { decodeCursor, Page, toPage } from '../../core/http/pagination';
import { RequestContext } from '../../core/http/request-context';
import { FilesService } from '../../core/files/files.service';
import { UnitChangeDto, UnitDto, UnitInputDto, UnitListQuery, UnitStatusChangeDto } from './dto/projects.dto';
import { ProjectsService } from './projects.service';
import { buildings, unitChanges, UnitRow, units, UnitStatus } from './projects.schema';

/**
 * Units (SRS §6.1–6.4): listed and filtered inside each project. Details are edited with projects.manage; price
 * and status only through changeStatus (units.change_status), and every price or status change is kept in history.
 */
@Injectable()
export class UnitsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly projects: ProjectsService,
  ) {}

  onModuleInit(): void {
    this.files.registerAccess('unit', {
      canView: async (id) => !!(await this.find(id)),
      canEdit: async (id) => !!(await this.find(id)) && !!RequestContext.get().principal?.permissions.has('projects.manage'),
    });
  }

  async list(q: UnitListQuery): Promise<Page<UnitDto>> {
    // Building, then unit number in natural order (2 before 10).
    const sortKey = sql<string>`lpad(regexp_replace(${units.unitNumber}, '\\D', '', 'g'), 12, '0') || ${units.unitNumber}`;
    const after = q.cursor ? (([key, id]) => sql`(${sortKey}, ${units.id}) > (${key}, ${id}::uuid)`)(decodeCursor(q.cursor, 2) as [string, string]) : undefined;
    const rows = await this.db.current
      .select({ u: units, key: sortKey })
      .from(units)
      .where(
        and(
          after,
          q.projectId ? eq(units.projectId, q.projectId) : undefined,
          q.buildingId ? eq(units.buildingId, q.buildingId) : undefined,
          q.propertyType ? eq(units.propertyType, q.propertyType) : undefined,
          q.bedrooms !== undefined ? eq(units.bedrooms, q.bedrooms) : undefined,
          q.priceMin ? gte(units.price, q.priceMin) : undefined,
          q.priceMax ? lte(units.price, q.priceMax) : undefined,
          q.status ? eq(units.status, q.status) : undefined,
        ),
      )
      .orderBy(asc(sortKey), asc(units.id))
      .limit(q.limit + 1);
    return toPage(rows, q.limit, (r) => [r.key, r.u.id], (r) => UnitDto.from(r.u));
  }

  async get(id: string): Promise<UnitRow> {
    const row = await this.find(id);
    if (!row) throw Problems.notFound();
    return row;
  }

  async create(body: UnitInputDto): Promise<UnitRow> {
    const missing = (['projectId', 'unitNumber', 'propertyType', 'bedrooms', 'sizeSqft', 'price'] as const).filter((f) => body[f] === undefined);
    if (missing.length) throw Problems.validation(missing.map((field) => ({ field, message: `${field} is required` })));
    await this.projects.getProject(body.projectId!).catch(() => {
      throw Problems.validation([{ field: 'projectId', message: 'project not found' }]);
    });
    if (body.buildingId) await this.checkBuilding(body.projectId!, body.buildingId);
    const [row] = await this.db.current
      .insert(units)
      .values({
        tenantId: this.db.currentTenantId!,
        projectId: body.projectId!,
        unitNumber: body.unitNumber!.trim(),
        propertyType: body.propertyType!,
        bedrooms: body.bedrooms!,
        sizeSqft: String(body.sizeSqft),
        price: body.price!,
        ...(body.currency ? { currency: body.currency } : {}),
        ...detailFields(body),
      })
      .returning()
      .catch(rethrow);
    await this.audit.record('create', 'units', row!.id, { unitNumber: [null, row!.unitNumber], price: [null, row!.price], status: [null, row!.status] });
    return row!;
  }

  /** Details only; price and status go through changeStatus so the history is kept. */
  async update(id: string, body: UnitInputDto): Promise<UnitRow> {
    const before = await this.get(id);
    const blocked = (['price', 'currency', 'holdExpiresAt', 'projectId'] as const).filter((f) => body[f] !== undefined && String(body[f]) !== String(before[f as keyof UnitRow] ?? ''));
    if (blocked.length) {
      throw Problems.validation(blocked.map((field) => ({ field, message: field === 'projectId' ? 'a unit cannot move to another project' : 'change price and status with POST /units/{id}/status' })));
    }
    if (body.buildingId) await this.checkBuilding(before.projectId, body.buildingId);
    const [after] = await this.db.current
      .update(units)
      .set({
        ...(body.unitNumber !== undefined ? { unitNumber: body.unitNumber.trim() } : {}),
        ...(body.propertyType !== undefined ? { propertyType: body.propertyType } : {}),
        ...(body.bedrooms !== undefined ? { bedrooms: body.bedrooms } : {}),
        ...(body.sizeSqft !== undefined ? { sizeSqft: String(body.sizeSqft) } : {}),
        ...detailFields(body),
      })
      .where(eq(units.id, id))
      .returning()
      .catch(rethrow);
    await this.audit.recordUpdate('units', id, detailView(before), detailView(after!));
    return after!;
  }

  /** POST /units/{id}/status (units.change_status): status and/or price, with the reason, kept in history. */
  async changeStatus(id: string, body: UnitStatusChangeDto, userId: string | null): Promise<UnitRow> {
    if (!body.status && !body.price) throw Problems.validation([{ field: 'status', message: 'send a status or a price' }]);
    return this.applyChange(id, { status: body.status, price: body.price, holdExpiresAt: body.holdExpiresAt, reason: body.reason ?? null }, userId);
  }

  /**
   * Status change made for another module (a deal booking or selling the unit), kept in the same history.
   */
  async setStatusForDeal(id: string, status: UnitStatus, reason: string, userId: string | null): Promise<UnitRow> {
    const unit = await this.get(id);
    if (unit.status === status) return unit;
    return this.applyChange(id, { status, reason }, userId);
  }

  /** Units by ID (reports). */
  async byIds(ids: string[]): Promise<Map<string, UnitRow>> {
    if (!ids.length) return new Map();
    const rows = await this.db.current.select().from(units).where(inArray(units.id, ids));
    return new Map(rows.map((r) => [r.id, r]));
  }

  async history(id: string): Promise<UnitChangeDto[]> {
    await this.get(id);
    const rows = await this.db.current.select().from(unitChanges).where(eq(unitChanges.unitId, id)).orderBy(desc(unitChanges.changedAt), desc(unitChanges.id));
    return rows.map(UnitChangeDto.from);
  }

  private async applyChange(id: string, change: { status?: UnitStatus; price?: string; holdExpiresAt?: string; reason: string | null }, userId: string | null): Promise<UnitRow> {
    const before = await this.get(id);
    const status = change.status ?? before.status;
    const price = change.price !== undefined ? Number(change.price).toFixed(2) : before.price;
    let holdExpiresAt: Date | null = null;
    if (status === 'on_hold') {
      holdExpiresAt = change.holdExpiresAt ? new Date(change.holdExpiresAt) : before.status === 'on_hold' ? before.holdExpiresAt : null;
      if (change.holdExpiresAt && (Number.isNaN(holdExpiresAt!.getTime()) || holdExpiresAt! <= new Date())) {
        throw Problems.validation([{ field: 'holdExpiresAt', message: 'must be a future date and time' }]);
      }
    } else if (change.holdExpiresAt) {
      throw Problems.validation([{ field: 'holdExpiresAt', message: 'only for status on_hold' }]);
    }
    const statusChanged = status !== before.status;
    const priceChanged = Number(price) !== Number(before.price);
    if (!statusChanged && !priceChanged && holdExpiresAt?.getTime() === before.holdExpiresAt?.getTime()) {
      throw Problems.validation([{ field: change.status ? 'status' : 'price', message: 'nothing changes' }]);
    }
    const [after] = await this.db.current.update(units).set({ status, price, holdExpiresAt, updatedAt: new Date() }).where(eq(units.id, id)).returning();
    if (statusChanged || priceChanged) {
      await this.db.current.insert(unitChanges).values({
        tenantId: this.db.currentTenantId!,
        unitId: id,
        oldStatus: statusChanged ? before.status : null,
        newStatus: statusChanged ? status : null,
        oldPrice: priceChanged ? before.price : null,
        newPrice: priceChanged ? price : null,
        reason: change.reason,
        changedBy: userId,
      });
    }
    await this.audit.recordUpdate('units', id, { status: before.status, price: before.price }, { status, price });
    return after!;
  }

  private async find(id: string): Promise<UnitRow | undefined> {
    const [row] = await this.db.current.select().from(units).where(eq(units.id, id)).limit(1);
    return row;
  }

  private async checkBuilding(projectId: string, buildingId: string): Promise<void> {
    const [b] = await this.db.current.select({ id: buildings.id }).from(buildings).where(and(eq(buildings.id, buildingId), eq(buildings.projectId, projectId))).limit(1);
    if (!b) throw Problems.validation([{ field: 'buildingId', message: 'building not found in this project' }]);
  }
}

function detailFields(body: UnitInputDto) {
  return {
    ...(body.buildingId !== undefined ? { buildingId: body.buildingId } : {}),
    ...(body.bathrooms !== undefined ? { bathrooms: body.bathrooms } : {}),
    ...(body.floor !== undefined ? { floor: body.floor } : {}),
    ...(body.view !== undefined ? { view: body.view } : {}),
    ...(body.paymentPlan !== undefined ? { paymentPlan: body.paymentPlan } : {}),
    ...(body.handoverDate !== undefined ? { handoverDate: body.handoverDate } : {}),
    ...(body.floorPlanFileId !== undefined ? { floorPlanFileId: body.floorPlanFileId } : {}),
  };
}

function detailView(u: UnitRow) {
  return {
    unitNumber: u.unitNumber,
    buildingId: u.buildingId,
    propertyType: u.propertyType,
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    sizeSqft: u.sizeSqft,
    floor: u.floor,
    view: u.view,
    paymentPlan: u.paymentPlan,
    handoverDate: u.handoverDate,
    floorPlanFileId: u.floorPlanFileId,
  };
}

function rethrow(err: unknown): never {
  if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ProblemException(409, 'CONFLICT', 'Already exists', 'This unit number already exists in this project or building.');
  if (pgCode(err) === PG_FOREIGN_KEY_VIOLATION) throw Problems.validation([{ field: 'currency', message: 'unknown currency or file' }]);
  throw err;
}
