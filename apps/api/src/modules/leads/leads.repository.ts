import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql, SQL } from 'drizzle-orm';
import { DbService } from '../../core/database/db.service';
import {
  activities,
  ActivityRow,
  ActivityType,
  AssignmentMethod,
  InquiryRow,
  leadAssignments,
  leadInquiries,
  leadProjects,
  LeadRow,
  leads,
  leadShares,
  leadStageHistory,
} from './leads.schema';

export type LeadInsert = typeof leads.$inferInsert;
export type LeadPatch = Partial<Omit<LeadRow, 'id' | 'tenantId' | 'createdAt' | 'version'>>;
export type InquiryInsert = Omit<typeof leadInquiries.$inferInsert, 'tenantId'>;

/** The latest move of a lead between owners (lead_assignments). */
export interface LatestAssignment {
  fromUserId: string | null;
  toUserId: string | null;
  changedBy: string | null;
  method: string;
  changedAt: Date;
}

export interface ActivityInput {
  type: ActivityType;
  summary: string;
  body?: string | null;
  actorUserId?: string | null;
  occurredAt?: Date;
  links?: Partial<Pick<ActivityRow, 'inquiryId' | 'taskId' | 'meetingId' | 'messageId' | 'fileId' | 'dealId' | 'financeDocumentId' | 'paymentId'>>;
}

@Injectable()
export class LeadsRepository {
  constructor(private readonly db: DbService) {}

  private get tenantId(): string {
    return this.db.currentTenantId!;
  }

  // ------------------------------------------------------------------ leads
  async find(id: string, where?: SQL): Promise<LeadRow | undefined> {
    const [row] = await this.db.current.select().from(leads).where(and(eq(leads.id, id), where)).limit(1);
    return row;
  }

  /** Locks the lead row for the rest of the transaction (concurrent stage changes, assignments, timers). */
  async lock(id: string): Promise<LeadRow | undefined> {
    const [row] = await this.db.current.select().from(leads).where(eq(leads.id, id)).limit(1).for('update');
    return row;
  }

  async list(where: SQL | undefined, orderBy: SQL[], limit: number, offset: number): Promise<LeadRow[]> {
    return this.db.current.select().from(leads).where(where).orderBy(...orderBy).limit(limit).offset(offset);
  }

  /** Leads per status (stage) matching the condition. */
  async countByStage(where: SQL | undefined): Promise<Map<string, number>> {
    const rows = await this.db.current.select({ stageId: leads.stageId, n: sql<number>`count(*)::int` }).from(leads).where(where).groupBy(leads.stageId);
    return new Map(rows.map((r) => [r.stageId, r.n]));
  }

  async count(where: SQL | undefined): Promise<number> {
    const [row] = await this.db.current.select({ n: sql<number>`count(*)::int` }).from(leads).where(where);
    return row?.n ?? 0;
  }

  /** Existing (not deleted) leads with any of these phones or this email: the re-enquiry / "already exists" match. */
  async findExisting(phones: string[], email: string | null, exceptId?: string): Promise<LeadRow | undefined> {
    const match: SQL[] = [];
    if (phones.length) match.push(inArray(leads.phonePrimary, phones), inArray(leads.phoneAlternate, phones));
    if (email) match.push(sql`${leads.email} = ${email}::citext`);
    if (!match.length) return undefined;
    const [row] = await this.db.current
      .select()
      .from(leads)
      .where(and(isNull(leads.deletedAt), or(...match), exceptId ? sql`${leads.id} <> ${exceptId}` : undefined))
      .orderBy(asc(leads.createdAt))
      .limit(1);
    return row;
  }

  async insert(values: Omit<LeadInsert, 'tenantId'>): Promise<LeadRow> {
    const [row] = await this.db.current.insert(leads).values({ ...values, tenantId: this.tenantId }).returning();
    return row!;
  }

  /** Updates and bumps the version; with `expectedVersion`, only when nobody saved in between. */
  async update(id: string, patch: LeadPatch, expectedVersion?: number): Promise<LeadRow | undefined> {
    const [row] = await this.db.current
      .update(leads)
      .set({ ...patch, version: sql`${leads.version} + 1` })
      .where(and(eq(leads.id, id), expectedVersion !== undefined ? eq(leads.version, expectedVersion) : undefined))
      .returning();
    return row;
  }

  /** System fields (score, last activity, follow-up from tasks, response timer): no version bump, so they never cause a VERSION_CONFLICT. */
  async touch(id: string, patch: LeadPatch): Promise<void> {
    await this.db.current.update(leads).set(patch).where(eq(leads.id, id));
  }

  // ------------------------------------------------------------------ projects
  async projectsOf(leadIds: string[]): Promise<Map<string, { projectIds: string[]; primaryProjectId?: string }>> {
    const result = new Map<string, { projectIds: string[]; primaryProjectId?: string }>();
    if (!leadIds.length) return result;
    const rows = await this.db.current.select().from(leadProjects).where(inArray(leadProjects.leadId, leadIds)).orderBy(asc(leadProjects.addedAt));
    for (const r of rows) {
      const entry = result.get(r.leadId) ?? { projectIds: [] };
      entry.projectIds.push(r.projectId);
      if (r.isPrimary) entry.primaryProjectId = r.projectId;
      result.set(r.leadId, entry);
    }
    return result;
  }

  async replaceProjects(leadId: string, projectIds: string[], primaryProjectId?: string): Promise<void> {
    await this.db.current.delete(leadProjects).where(eq(leadProjects.leadId, leadId));
    if (projectIds.length) {
      await this.db.current
        .insert(leadProjects)
        .values(projectIds.map((projectId) => ({ tenantId: this.tenantId, leadId, projectId, isPrimary: projectId === primaryProjectId })));
    }
  }

  async addProject(leadId: string, projectId: string): Promise<void> {
    await this.db.current.insert(leadProjects).values({ tenantId: this.tenantId, leadId, projectId }).onConflictDoNothing();
  }

  // ------------------------------------------------------------------ enquiries, history, assignments
  async insertInquiry(values: InquiryInsert): Promise<InquiryRow> {
    const [row] = await this.db.current.insert(leadInquiries).values({ ...values, tenantId: this.tenantId }).returning();
    return row!;
  }

  async inquiries(leadId: string): Promise<InquiryRow[]> {
    return this.db.current.select().from(leadInquiries).where(eq(leadInquiries.leadId, leadId)).orderBy(desc(leadInquiries.submittedAt));
  }

  async submissionExists(sourceId: string, externalSubmissionId: string): Promise<boolean> {
    const rows = await this.db.current
      .select({ id: leadInquiries.id })
      .from(leadInquiries)
      .where(and(eq(leadInquiries.sourceId, sourceId), eq(leadInquiries.externalSubmissionId, externalSubmissionId)))
      .limit(1);
    return rows.length > 0;
  }

  /** External submission IDs (e.g. Meta lead IDs) already imported through one integration. */
  async knownSubmissions(integrationId: string, externalSubmissionIds: string[]): Promise<string[]> {
    if (!externalSubmissionIds.length) return [];
    const rows = await this.db.current
      .selectDistinct({ id: leadInquiries.externalSubmissionId })
      .from(leadInquiries)
      .where(and(eq(leadInquiries.integrationId, integrationId), inArray(leadInquiries.externalSubmissionId, externalSubmissionIds)));
    return rows.map((r) => r.id!);
  }

  async insertStageHistory(values: { leadId: string; fromStageId: string | null; toStageId: string; toSubstatusId?: string | null; reasonId?: string | null; note?: string | null; isAutomatic?: boolean; changedBy?: string | null }): Promise<void> {
    await this.db.current.insert(leadStageHistory).values({ ...values, tenantId: this.tenantId });
  }

  /** The latest assignment of each lead (Assigned From). */
  async latestAssignments(leadIds: string[]): Promise<Map<string, LatestAssignment>> {
    if (!leadIds.length) return new Map();
    const rows = await this.db.current
      .selectDistinctOn([leadAssignments.leadId], {
        leadId: leadAssignments.leadId,
        fromUserId: leadAssignments.fromUserId,
        toUserId: leadAssignments.toUserId,
        changedBy: leadAssignments.changedBy,
        method: leadAssignments.method,
        changedAt: leadAssignments.changedAt,
      })
      .from(leadAssignments)
      .where(inArray(leadAssignments.leadId, leadIds))
      .orderBy(leadAssignments.leadId, desc(leadAssignments.changedAt));
    return new Map(rows.map((r) => [r.leadId, r]));
  }

  /** Every move of one lead between owners, newest first (lead page assignment history). */
  async assignmentsOf(leadId: string) {
    return this.db.current.select().from(leadAssignments).where(eq(leadAssignments.leadId, leadId)).orderBy(desc(leadAssignments.changedAt), desc(leadAssignments.id));
  }

  async insertAssignment(values: {
    leadId: string;
    fromUserId: string | null;
    toUserId: string | null;
    method: AssignmentMethod;
    ruleId?: string | null;
    reasonId?: string | null;
    note?: string | null;
    changedBy?: string | null;
  }): Promise<void> {
    await this.db.current.insert(leadAssignments).values({ ...values, tenantId: this.tenantId });
  }

  /** Users who already held this lead since its last manual or re-enquiry assignment (the 10-minute rule chain). */
  async missedBy(leadId: string): Promise<string[]> {
    const rows = await this.db.current
      .select({ from: leadAssignments.fromUserId, method: leadAssignments.method })
      .from(leadAssignments)
      .where(eq(leadAssignments.leadId, leadId))
      .orderBy(desc(leadAssignments.changedAt));
    const missed: string[] = [];
    for (const r of rows) {
      if (r.method !== 'no_response') break;
      if (r.from) missed.push(r.from);
    }
    return missed;
  }

  // ------------------------------------------------------------------ shares
  async shares(leadId: string) {
    return this.db.current.select().from(leadShares).where(eq(leadShares.leadId, leadId)).orderBy(asc(leadShares.sharedAt));
  }

  async upsertShare(leadId: string, userId: string, access: 'view' | 'edit', sharedBy: string) {
    const [row] = await this.db.current
      .insert(leadShares)
      .values({ tenantId: this.tenantId, leadId, userId, access, sharedBy })
      .onConflictDoUpdate({ target: [leadShares.leadId, leadShares.userId], set: { access, sharedBy, sharedAt: sql`now()` } })
      .returning();
    return row!;
  }

  async deleteShare(leadId: string, userId: string): Promise<boolean> {
    const rows = await this.db.current
      .delete(leadShares)
      .where(and(eq(leadShares.leadId, leadId), eq(leadShares.userId, userId)))
      .returning({ userId: leadShares.userId });
    return rows.length > 0;
  }

  // ------------------------------------------------------------------ timeline
  async addActivity(leadId: string, input: ActivityInput): Promise<ActivityRow> {
    const [row] = await this.db.current
      .insert(activities)
      .values({
        tenantId: this.tenantId,
        leadId,
        type: input.type,
        summary: input.summary,
        body: input.body ?? null,
        actorUserId: input.actorUserId ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        ...input.links,
      })
      .returning();
    return row!;
  }

  async timeline(leadId: string, limit: number, offset: number, types?: ActivityType[]): Promise<ActivityRow[]> {
    return this.db.current
      .select()
      .from(activities)
      .where(and(eq(activities.leadId, leadId), types?.length ? inArray(activities.type, types) : undefined))
      .orderBy(desc(activities.occurredAt), desc(activities.id))
      .limit(limit)
      .offset(offset);
  }
}
