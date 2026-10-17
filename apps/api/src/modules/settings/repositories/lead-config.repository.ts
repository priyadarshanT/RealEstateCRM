import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql, SQL } from 'drizzle-orm';
import { DbService } from '../../../core/database/db.service';
import { decodeCursor } from '../../../core/http/pagination';
import { LeadSourceRow, leadSources, LeadStageRow, leadStages, LeadSubstatusRow, leadSubstatuses, ReasonRow, reasons } from '../settings.schema';

export type SubstatusValues = Partial<Pick<LeadSubstatusRow, 'name' | 'sortOrder' | 'isActive' | 'requiresScheduling'>>;
export type ReasonValues = Partial<Pick<ReasonRow, 'type' | 'key' | 'name' | 'isActive'>>;
export type SourceValues = Partial<Pick<LeadSourceRow, 'type' | 'name' | 'integrationId' | 'qualityScore' | 'isActive'>>;

// List orders (stable for cursor paging): stages by stage-bar order, reasons by type and name, sources by name.
export const stageCursor = (r: LeadStageRow): unknown[] => [r.sortOrder, r.id];
export const reasonCursor = (r: ReasonRow): unknown[] => [r.type, r.name, r.id];
export const sourceCursor = (r: LeadSourceRow): unknown[] => [r.name, r.id];

/** Lead stages, reasons and lead sources (SRS §2.19, §2.21, §11.5). */
@Injectable()
export class LeadConfigRepository {
  constructor(private readonly db: DbService) {}

  // ---- stages
  async listStages(limit: number, cursor?: string): Promise<LeadStageRow[]> {
    let after: SQL | undefined;
    if (cursor) {
      const [order, id] = decodeCursor(cursor, 2) as [number, string];
      after = sql`(${leadStages.sortOrder}, ${leadStages.id}) > (${order}, ${id}::uuid)`;
    }
    return this.db.current.select().from(leadStages).where(after).orderBy(asc(leadStages.sortOrder), asc(leadStages.id)).limit(limit + 1);
  }

  async findStage(id: string): Promise<LeadStageRow | undefined> {
    const [row] = await this.db.current.select().from(leadStages).where(eq(leadStages.id, id)).limit(1);
    return row;
  }

  async findStageByKey(key: string): Promise<LeadStageRow | undefined> {
    const [row] = await this.db.current.select().from(leadStages).where(eq(leadStages.key, key)).limit(1);
    return row;
  }

  // ---- substatuses
  async listSubstatuses(stageId?: string): Promise<LeadSubstatusRow[]> {
    return this.db.current
      .select()
      .from(leadSubstatuses)
      .where(stageId ? eq(leadSubstatuses.stageId, stageId) : undefined)
      .orderBy(asc(leadSubstatuses.stageId), asc(leadSubstatuses.sortOrder), asc(leadSubstatuses.name));
  }

  async findSubstatus(id: string): Promise<LeadSubstatusRow | undefined> {
    const [row] = await this.db.current.select().from(leadSubstatuses).where(eq(leadSubstatuses.id, id)).limit(1);
    return row;
  }

  async createSubstatus(values: Pick<LeadSubstatusRow, 'stageId' | 'name' | 'sortOrder'> & SubstatusValues, tenantId: string): Promise<LeadSubstatusRow> {
    const [row] = await this.db.current.insert(leadSubstatuses).values({ ...values, tenantId }).returning();
    return row!;
  }

  async updateSubstatus(id: string, values: SubstatusValues, expectedVersion?: string): Promise<LeadSubstatusRow | undefined> {
    const [row] = await this.db.current
      .update(leadSubstatuses)
      .set(values)
      .where(and(eq(leadSubstatuses.id, id), expectedVersion ? eq(leadSubstatuses.updatedAt, expectedVersion) : undefined))
      .returning();
    return row;
  }

  async deleteSubstatus(id: string): Promise<void> {
    await this.db.current.delete(leadSubstatuses).where(eq(leadSubstatuses.id, id));
  }

  // ---- reasons
  async listReasons(limit: number, cursor?: string, type?: ReasonRow['type']): Promise<ReasonRow[]> {
    const where: (SQL | undefined)[] = [type ? eq(reasons.type, type) : undefined];
    if (cursor) {
      const [t, name, id] = decodeCursor(cursor, 3) as [string, string, string];
      where.push(sql`(${reasons.type}, ${reasons.name}, ${reasons.id}) > (${t}, ${name}, ${id}::uuid)`);
    }
    return this.db.current
      .select()
      .from(reasons)
      .where(and(...where))
      .orderBy(asc(reasons.type), asc(reasons.name), asc(reasons.id))
      .limit(limit + 1);
  }

  async findReason(id: string): Promise<ReasonRow | undefined> {
    const [row] = await this.db.current.select().from(reasons).where(eq(reasons.id, id)).limit(1);
    return row;
  }

  async findReasonByKey(type: ReasonRow['type'], key: string): Promise<ReasonRow | undefined> {
    const [row] = await this.db.current.select().from(reasons).where(and(eq(reasons.type, type), eq(reasons.key, key))).limit(1);
    return row;
  }

  async createReason(values: Required<Pick<ReasonRow, 'type' | 'name'>> & ReasonValues, tenantId: string): Promise<ReasonRow> {
    const [row] = await this.db.current.insert(reasons).values({ ...values, tenantId }).returning();
    return row!;
  }

  async updateReason(id: string, values: ReasonValues): Promise<ReasonRow | undefined> {
    const [row] = await this.db.current.update(reasons).set(values).where(eq(reasons.id, id)).returning();
    return row;
  }

  async deleteReason(id: string): Promise<void> {
    await this.db.current.delete(reasons).where(eq(reasons.id, id));
  }

  // ---- sources
  async listSources(limit: number, cursor?: string): Promise<LeadSourceRow[]> {
    let after: SQL | undefined;
    if (cursor) {
      const [name, id] = decodeCursor(cursor, 2) as [string, string];
      after = sql`(${leadSources.name}, ${leadSources.id}) > (${name}, ${id}::uuid)`;
    }
    return this.db.current.select().from(leadSources).where(after).orderBy(asc(leadSources.name), asc(leadSources.id)).limit(limit + 1);
  }

  async findSource(id: string): Promise<LeadSourceRow | undefined> {
    const [row] = await this.db.current.select().from(leadSources).where(eq(leadSources.id, id)).limit(1);
    return row;
  }

  async findSourceByType(type: LeadSourceRow['type']): Promise<LeadSourceRow | undefined> {
    const [row] = await this.db.current
      .select()
      .from(leadSources)
      .where(and(eq(leadSources.type, type), eq(leadSources.isActive, true)))
      .orderBy(asc(leadSources.name))
      .limit(1);
    return row;
  }

  async createSource(values: Required<Pick<LeadSourceRow, 'type' | 'name'>> & SourceValues, tenantId: string): Promise<LeadSourceRow> {
    const [row] = await this.db.current.insert(leadSources).values({ ...values, tenantId }).returning();
    return row!;
  }

  async updateSource(id: string, values: SourceValues): Promise<LeadSourceRow | undefined> {
    const [row] = await this.db.current.update(leadSources).set(values).where(eq(leadSources.id, id)).returning();
    return row;
  }

  async deleteSource(id: string): Promise<void> {
    await this.db.current.delete(leadSources).where(eq(leadSources.id, id));
  }
}
