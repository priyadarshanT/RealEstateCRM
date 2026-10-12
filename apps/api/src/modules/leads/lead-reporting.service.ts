import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNotNull, isNull, lt, sql, SQL } from 'drizzle-orm';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { LeadConfigService } from '../settings/lead-config.service';
import { LeadScope } from './lead-scope';
import { activities, leadAssignments, leadInquiries, leadProjects, leads, leadStageHistory } from './leads.schema';

/** The filters every report and the dashboard accept (SRS §8.1, §10.6). Dates are inclusive days (UTC). */
export interface ReportFilters {
  from?: string;
  to?: string;
  projectId?: string;
  sourceId?: string;
  campaignId?: string;
  teamId?: string;
  userId?: string;
  eventId?: string;
}

export interface Bucket {
  key: string;
  count: number;
}

/** Funnel steps (SRS §10.3) and the stage keys that mean a lead reached each step. */
export const FUNNEL: { key: string; label: string; stages: string[] }[] = [
  { key: 'lead', label: 'Lead', stages: [] },
  { key: 'contacted', label: 'Contacted', stages: ['follow_up', 'warm', 'hot', 'qualified', 'meeting_scheduled', 'viewing_scheduled', 'eoi_submitted', 'booked', 'won'] },
  { key: 'qualified', label: 'Qualified', stages: ['qualified', 'meeting_scheduled', 'viewing_scheduled', 'eoi_submitted', 'booked', 'won'] },
  { key: 'meeting', label: 'Meeting', stages: ['meeting_scheduled', 'viewing_scheduled', 'eoi_submitted', 'booked', 'won'] },
  { key: 'eoi', label: 'EOI', stages: ['eoi_submitted', 'booked', 'won'] },
  { key: 'booking', label: 'Booking', stages: ['booked', 'won'] },
  { key: 'sale', label: 'Sale', stages: ['won'] },
];

/**
 * Lead figures for the dashboard and reports. They read the leads tables here, inside the leads module, and are
 * always limited to the user's data scope (API guide §3).
 */
@Injectable()
export class LeadReportingService {
  constructor(
    private readonly db: DbService,
    private readonly scope: LeadScope,
    private readonly config: LeadConfigService,
  ) {}

  /** Leads in scope, not deleted, matching the filters; `createdInPeriod` limits to leads created between from and to. */
  async where(p: Principal, f: ReportFilters, createdInPeriod = true): Promise<SQL | undefined> {
    return and(
      isNull(leads.deletedAt),
      await this.scope.visible(p),
      createdInPeriod && f.from ? gte(leads.createdAt, dayStart(f.from)) : undefined,
      createdInPeriod && f.to ? lt(leads.createdAt, dayAfter(f.to)) : undefined,
      f.sourceId ? eq(leads.sourceId, f.sourceId) : undefined,
      f.campaignId ? eq(leads.campaignId, f.campaignId) : undefined,
      f.eventId ? eq(leads.eventId, f.eventId) : undefined,
      f.teamId ? eq(leads.teamId, f.teamId) : undefined,
      f.userId ? eq(leads.ownerUserId, f.userId) : undefined,
      f.projectId ? sql`EXISTS (SELECT 1 FROM ${leadProjects} WHERE ${leadProjects.leadId} = ${leads.id} AND ${leadProjects.projectId} = ${f.projectId})` : undefined,
    );
  }

  /** Stage IDs by key, to test "reached stage X" in the stage history. */
  async stageIds(keys: string[]): Promise<string[]> {
    const ids = await Promise.all(keys.map((k) => this.config.stageByKey(k)));
    return ids.filter((s): s is NonNullable<typeof s> => Boolean(s)).map((s) => s.id);
  }

  private reached(stageIds: string[], f: ReportFilters): SQL {
    if (!stageIds.length) return sql`true`;
    return sql`EXISTS (SELECT 1 FROM ${leadStageHistory} h WHERE h.lead_id = ${leads.id} AND h.to_stage_id IN ${sql.raw(`('${stageIds.join("','")}')`)}${
      f.from ? sql` AND h.changed_at >= ${dayStart(f.from)}` : sql``
    }${f.to ? sql` AND h.changed_at < ${dayAfter(f.to)}` : sql``})`;
  }

  // ---------------------------------------------------------------- dashboard
  async kpis(p: Principal, f: ReportFilters) {
    const inPeriod = await this.where(p, f);
    const current = await this.where(p, f, false);
    const [newStage] = await this.stageIds(['new']);
    const [qualified, eoi, booked] = await Promise.all([this.stageIds(FUNNEL[2]!.stages), this.stageIds(['eoi_submitted']), this.stageIds(['booked'])]);
    const now = new Date();
    const [row] = await this.db.current
      .select({
        total: sql<number>`count(*) FILTER (WHERE ${inPeriod ?? sql`true`})::int`,
        new: sql<number>`count(*) FILTER (WHERE ${leads.stageId} = ${newStage ?? null})::int`,
        untouched: sql<number>`count(*) FILTER (WHERE ${leads.stageCategory} = 'open' AND ${leads.ownerUserId} IS NOT NULL AND ${leads.firstResponseAt} IS NULL AND ${leads.lastActivityAt} IS NULL)::int`,
        overdue: sql<number>`count(*) FILTER (WHERE ${leads.stageCategory} = 'open' AND ${leads.ownerUserId} IS NOT NULL AND ${leads.nextFollowUpAt} < ${now})::int`,
        reEnquired: sql<number>`count(*) FILTER (WHERE ${leads.enquiryCount} > 1${f.from ? sql` AND ${leads.lastEnquiryAt} >= ${dayStart(f.from)}` : sql``}${f.to ? sql` AND ${leads.lastEnquiryAt} < ${dayAfter(f.to)}` : sql``})::int`,
        qualified: sql<number>`count(*) FILTER (WHERE ${this.reached(qualified, f)})::int`,
        eois: sql<number>`count(*) FILTER (WHERE ${this.reached(eoi, f)})::int`,
        bookings: sql<number>`count(*) FILTER (WHERE ${this.reached(booked, f)})::int`,
      })
      .from(leads)
      .where(current);
    return row!;
  }

  async groupBy(p: Principal, f: ReportFilters, dimension: 'source' | 'stage' | 'agent' | 'campaign' | 'project' | 'form'): Promise<Bucket[]> {
    const where = await this.where(p, f);
    if (dimension === 'project') {
      const rows = await this.db.current
        .select({ key: leadProjects.projectId, count: sql<number>`count(DISTINCT ${leads.id})::int` })
        .from(leads)
        .innerJoin(leadProjects, eq(leadProjects.leadId, leads.id))
        .where(where)
        .groupBy(leadProjects.projectId)
        .orderBy(sql`2 DESC`);
      return rows;
    }
    const column = { source: leads.sourceId, stage: leads.stageId, agent: leads.ownerUserId, campaign: leads.campaignId, form: leads.formName }[dimension];
    const rows = await this.db.current
      .select({ key: sql<string | null>`${column}::text`, count: sql<number>`count(*)::int` })
      .from(leads)
      .where(where)
      .groupBy(column)
      .orderBy(sql`2 DESC`);
    return rows.map((r) => ({ key: r.key ?? 'none', count: r.count }));
  }

  async funnel(p: Principal, f: ReportFilters): Promise<{ key: string; label: string; count: number }[]> {
    const where = await this.where(p, f);
    const steps = await Promise.all(FUNNEL.map(async (s) => ({ ...s, ids: await this.stageIds(s.stages) })));
    const [row] = await this.db.current
      .select(Object.fromEntries(steps.map((s) => [s.key, sql<number>`count(*) FILTER (WHERE ${s.stages.length ? this.reached(s.ids, {}) : sql`true`})::int`])) as Record<string, SQL<number>>)
      .from(leads)
      .where(where);
    return steps.map((s) => ({ key: s.key, label: s.label, count: Number((row as Record<string, number>)[s.key] ?? 0) }));
  }

  /** Leads and qualified leads per day (dashboard line chart). */
  async trend(p: Principal, f: ReportFilters): Promise<{ date: string; leads: number; qualified: number }[]> {
    const where = await this.where(p, f);
    const qualified = await this.stageIds(FUNNEL[2]!.stages);
    const rows = await this.db.current
      .select({
        date: sql<string>`to_char(date_trunc('day', ${leads.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
        leads: sql<number>`count(*)::int`,
        qualified: sql<number>`count(*) FILTER (WHERE ${this.reached(qualified, {})})::int`,
      })
      .from(leads)
      .where(where)
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    return rows;
  }

  // ---------------------------------------------------------------- report rows
  async leadRows(p: Principal, f: ReportFilters, extra: SQL | undefined, limit: number, offset: number) {
    const where = and(await this.where(p, f), extra);
    const rows = await this.db.current
      .select({
        id: leads.id,
        fullName: leads.fullName,
        phonePrimary: leads.phonePrimary,
        email: leads.email,
        sourceId: leads.sourceId,
        campaignId: leads.campaignId,
        formName: leads.formName,
        ownerUserId: leads.ownerUserId,
        stageId: leads.stageId,
        stageCategory: leads.stageCategory,
        closeReasonId: leads.closeReasonId,
        priority: leads.priority,
        score: leads.score,
        enquiryCount: leads.enquiryCount,
        nextFollowUpAt: leads.nextFollowUpAt,
        lastEnquiryAt: leads.lastEnquiryAt,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .where(where)
      .orderBy(sql`${leads.createdAt} DESC`, leads.id)
      .limit(limit)
      .offset(offset);
    const [count] = await this.db.current.select({ n: sql<number>`count(*)::int` }).from(leads).where(where);
    return { rows, total: count?.n ?? 0 };
  }

  /** Conditions for the lead list reports (SRS §8.2). */
  async preset(kind: 'all' | 'new' | 'pending' | 'scheduled' | 'overdue' | 'untouched' | 'lost' | 're_enquiries'): Promise<SQL | undefined> {
    const now = new Date();
    switch (kind) {
      case 'new':
      case 'pending':
        return eq(leads.stageId, (await this.stageIds([kind]))[0] ?? '00000000-0000-0000-0000-000000000000');
      case 'scheduled':
        return and(eq(leads.stageCategory, 'open'), gte(leads.nextFollowUpAt, now));
      case 'overdue':
        return and(eq(leads.stageCategory, 'open'), isNotNull(leads.ownerUserId), lt(leads.nextFollowUpAt, now));
      case 'untouched':
        return and(eq(leads.stageCategory, 'open'), isNotNull(leads.ownerUserId), isNull(leads.firstResponseAt), isNull(leads.lastActivityAt));
      case 'lost':
        return inArray(leads.stageCategory, ['lost', 'invalid']);
      case 're_enquiries':
        return sql`${leads.enquiryCount} > 1`;
      default:
        return undefined;
    }
  }

  /** Per agent (SRS §8.4): leads owned, contacted, qualified, won, average response minutes, leads missed (10-minute rule). */
  async agentPerformance(p: Principal, f: ReportFilters) {
    const where = await this.where(p, f);
    const [contacted, qualified, won] = await Promise.all([this.stageIds(FUNNEL[1]!.stages), this.stageIds(FUNNEL[2]!.stages), this.stageIds(['won'])]);
    const rows = await this.db.current
      .select({
        userId: leads.ownerUserId,
        leads: sql<number>`count(*)::int`,
        contacted: sql<number>`count(*) FILTER (WHERE ${leads.firstResponseAt} IS NOT NULL OR ${this.reached(contacted, {})})::int`,
        qualified: sql<number>`count(*) FILTER (WHERE ${this.reached(qualified, {})})::int`,
        won: sql<number>`count(*) FILTER (WHERE ${this.reached(won, {})})::int`,
        avgResponseMinutes: sql<string | null>`round(avg(extract(epoch FROM ${leads.firstResponseAt} - ${leads.assignedAt}) / 60)::numeric, 1)`,
      })
      .from(leads)
      .where(and(where, isNotNull(leads.ownerUserId)))
      .groupBy(leads.ownerUserId);
    const missed = await this.db.current
      .select({ userId: leadAssignments.fromUserId, n: sql<number>`count(*)::int` })
      .from(leadAssignments)
      .where(
        and(
          sql`${leadAssignments.method} IN ('no_response', 'admin_fallback')`,
          f.from ? gte(leadAssignments.changedAt, dayStart(f.from)) : undefined,
          f.to ? lt(leadAssignments.changedAt, dayAfter(f.to)) : undefined,
        ),
      )
      .groupBy(leadAssignments.fromUserId);
    const missedOf = new Map(missed.map((m) => [m.userId, m.n]));
    return rows.map((r) => ({ ...r, avgResponseMinutes: r.avgResponseMinutes === null ? null : Number(r.avgResponseMinutes), missed: missedOf.get(r.userId) ?? 0 }));
  }

  /** Leads and qualified leads per campaign or event (marketing and event reports). */
  async byCampaignOrEvent(p: Principal, f: ReportFilters, by: 'campaign' | 'event') {
    const where = await this.where(p, f);
    const qualified = await this.stageIds(FUNNEL[2]!.stages);
    const booked = await this.stageIds(['booked', 'won']);
    const meeting = await this.stageIds(FUNNEL[3]!.stages);
    const column = by === 'campaign' ? leads.campaignId : leads.eventId;
    return this.db.current
      .select({
        key: column,
        leads: sql<number>`count(*)::int`,
        qualified: sql<number>`count(*) FILTER (WHERE ${this.reached(qualified, {})})::int`,
        meetings: sql<number>`count(*) FILTER (WHERE ${this.reached(meeting, {})})::int`,
        bookings: sql<number>`count(*) FILTER (WHERE ${this.reached(booked, {})})::int`,
      })
      .from(leads)
      .where(and(where, isNotNull(column)))
      .groupBy(column);
  }

  /** Re-enquiries per day in the period (enquiries flagged as repeat). */
  async reEnquiryCount(p: Principal, f: ReportFilters): Promise<number> {
    const [row] = await this.db.current
      .select({ n: sql<number>`count(*)::int` })
      .from(leadInquiries)
      .innerJoin(leads, eq(leads.id, leadInquiries.leadId))
      .where(
        and(
          eq(leadInquiries.isReEnquiry, true),
          await this.where(p, { ...f, from: undefined, to: undefined }, false),
          f.from ? gte(leadInquiries.receivedAt, dayStart(f.from)) : undefined,
          f.to ? lt(leadInquiries.receivedAt, dayAfter(f.to)) : undefined,
        ),
      );
    return row?.n ?? 0;
  }

  /** Answered calls count per lead feed the score; here: call activities per agent (call outcome report uses tasks). */
  async activityCount(p: Principal, f: ReportFilters, type: string): Promise<number> {
    const [row] = await this.db.current
      .select({ n: sql<number>`count(*)::int` })
      .from(activities)
      .innerJoin(leads, eq(leads.id, activities.leadId))
      .where(and(eq(activities.type, type as never), await this.where(p, f, false), f.from ? gte(activities.occurredAt, dayStart(f.from)) : undefined, f.to ? lt(activities.occurredAt, dayAfter(f.to)) : undefined));
    return row?.n ?? 0;
  }
}

/** Full data export (SRS §12): every enquiry and timeline entry of the company, in pages. */
export async function exportPage(db: DbService, table: 'enquiries' | 'timeline', limit: number, offset: number): Promise<Record<string, unknown>[]> {
  if (table === 'enquiries') {
    const rows = await db.current.select().from(leadInquiries).orderBy(leadInquiries.receivedAt, leadInquiries.id).limit(limit).offset(offset);
    return rows.map((i) => ({ leadId: i.leadId, sourceId: i.sourceId, isReEnquiry: i.isReEnquiry, formName: i.formName, externalSubmissionId: i.externalSubmissionId, formAnswers: JSON.stringify(i.formAnswers), submittedAt: i.submittedAt.toISOString() }));
  }
  const rows = await db.current.select().from(activities).orderBy(activities.occurredAt, activities.id).limit(limit).offset(offset);
  return rows.map((a) => ({ leadId: a.leadId, type: a.type, summary: a.summary, body: a.body, actorUserId: a.actorUserId, occurredAt: a.occurredAt.toISOString() }));
}

export function dayStart(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}

export function dayAfter(d: string): Date {
  return new Date(dayStart(d).getTime() + 86_400_000);
}
