import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, sql, SQL } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { WorkerDbService } from '../../core/database/worker-db.service';
import { Problems } from '../../core/errors/problem';
import { pgCode, PG_FOREIGN_KEY_VIOLATION } from '../../core/errors/pg';
import { EventBus } from '../../core/events/domain-events';
import { decodeCursor, encodeCursor } from '../../core/http/pagination';
import { RequestContext } from '../../core/http/request-context';
import { OrganizationDirectory } from '../organization/directory.service';
import { LeadConfigService } from '../settings/lead-config.service';
import { SettingsService } from '../settings/settings.service';
import {
  CheckExistingResult,
  LeadCreateDto,
  LeadDto,
  LeadExistsDto,
  LeadListQuery,
  LeadPage,
  LeadUpdateDto,
} from './dto/lead.dto';
import { canEdit, canManage, LeadAccess, LeadScope } from './lead-scope';
import { LeadErrors } from './leads.errors';
import { ActivityInput, LeadPatch, LeadsRepository } from './leads.repository';
import { activities, AssignmentMethod, LeadRow, leadProjects, leads, leadShares, savedFilters } from './leads.schema';
import { dayStart, dayAfter } from '../../core/http/dates';

export interface OwnerChange {
  method: AssignmentMethod;
  actorUserId?: string | null;
  reasonId?: string | null;
  ruleId?: string | null;
  note?: string | null;
}

const SORTABLE = {
  score: leads.score,
  nextFollowUpAt: leads.nextFollowUpAt,
  createdAt: leads.createdAt,
  updatedAt: leads.updatedAt,
  lastEnquiryAt: leads.lastEnquiryAt,
  fullName: leads.fullName,
} as const;
const DEFAULT_SORT = '-score,nextFollowUpAt';
const EDITABLE = [
  'fullName',
  'phonePrimary',
  'phoneAlternate',
  'email',
  'countryCode',
  'preferredLanguage',
  'budgetMin',
  'budgetMax',
  'budgetCurrency',
  'campaignId',
  'eventId',
  'priority',
] as const;

/**
 * Leads: list with tabs and filters, lead page, create, edit, delete and restore (SRS §2), and the owner
 * change used by every assignment path. Other modules use the public methods below; they never touch lead tables.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly repo: LeadsRepository,
    private readonly scope: LeadScope,
    private readonly config: LeadConfigService,
    private readonly settings: SettingsService,
    private readonly directory: OrganizationDirectory,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly db: DbService,
    private readonly workerDb: WorkerDbService,
  ) {}

  // =================================================================== reading
  /** A lead the principal may see, with their access. 404 when outside their scope (API guide §3). */
  async visible(p: Principal, id: string, options: { includeDeleted?: boolean } = {}): Promise<{ lead: LeadRow; access: LeadAccess }> {
    const lead = await this.repo.find(id);
    const access = lead && (await this.scope.accessFor(p, [lead])).get(lead.id);
    if (!lead || !access || (lead.deletedAt && !options.includeDeleted)) throw Problems.notFound();
    return { lead, access };
  }

  async editable(p: Principal, id: string): Promise<{ lead: LeadRow; access: LeadAccess }> {
    const found = await this.visible(p, id);
    if (!canEdit(found.access)) throw Problems.forbidden('This lead is shared with you as view only.');
    return found;
  }

  async managed(p: Principal, id: string, options: { includeDeleted?: boolean } = {}): Promise<{ lead: LeadRow; access: LeadAccess }> {
    const found = await this.visible(p, id, options);
    if (!canManage(found.access)) throw Problems.forbidden('Only the owner or a manager above them can do this.');
    return found;
  }

  async get(p: Principal, id: string): Promise<LeadDto> {
    const { lead, access } = await this.visible(p, id, { includeDeleted: p.permissions.has('leads.delete') });
    return this.toDto(lead, access);
  }

  async toDto(lead: LeadRow, access?: LeadAccess): Promise<LeadDto> {
    const hide = await this.hidesContact();
    return maskContact(LeadDto.from(lead, (await this.repo.projectsOf([lead.id])).get(lead.id), access), hide);
  }

  // =================================================================== Global Configuration › Leads switches
  /** The lead feature switches of this company (export, source update, past dates, hidden contact info …). */
  async features() {
    return this.settings.get('leads.features');
  }

  /** True when the signed-in user's role must not see lead phone numbers and emails (enforced in every response). */
  async hidesContact(): Promise<boolean> {
    const role = RequestContext.get().principal?.roleKey;
    if (!role) return false;
    const { hide_contact_info: hide } = await this.features();
    return hide.enabled && hide.role_keys.includes(role);
  }

  /** Follow-up dates in the past are refused unless Enable Past Date Selection is on (5 minutes of grace). */
  async assertDateAllowed(iso: string, field: string): Promise<void> {
    if (Date.parse(iso) >= Date.now() - 5 * 60_000) return;
    if (!(await this.features()).past_date_selection) {
      throw Problems.validation([{ field, message: 'past dates are turned off (Global Configuration › Leads)' }]);
    }
  }

  async list(p: Principal, query: LeadListQuery): Promise<LeadPage> {
    const filters = await this.withSavedFilter(p, query);
    const where = and(await this.scope.visible(p), ...(await this.conditions(p, filters)));
    const offset = query.cursor ? Number(decodeCursor(query.cursor, 1)[0]) : 0;
    const rows = await this.repo.list(where, this.orderBy(filters.sort ?? DEFAULT_SORT), query.limit + 1, offset);
    const kept = rows.slice(0, query.limit);
    const [access, projects] = await Promise.all([this.scope.accessFor(p, kept), this.repo.projectsOf(kept.map((r) => r.id))]);
    const hasMore = rows.length > query.limit;
    const hide = await this.hidesContact();
    return {
      data: kept.map((l) => maskContact(LeadDto.from(l, projects.get(l.id), access.get(l.id)), hide)),
      page: {
        nextCursor: hasMore ? encodeCursor([offset + query.limit]) : null,
        hasMore,
        ...(query.total ? { total: await this.repo.count(where) } : {}),
      },
    };
  }

  /** "This lead already exists, owned by …" while typing a new lead (SRS §2.9). Not limited to the user's scope. */
  async checkExisting(phone?: string, email?: string): Promise<CheckExistingResult> {
    const lead = await this.repo.findExisting(phone ? [phone] : [], email ?? null);
    return { exists: Boolean(lead), lead: lead ? await this.existsInfo(lead) : null };
  }

  // =================================================================== create / edit
  async create(p: Principal, body: LeadCreateDto): Promise<LeadDto> {
    if (!body.phonePrimary && !body.email) throw LeadErrors.contactRequired();
    validateBudget(body);
    const phones = [body.phonePrimary, body.phoneAlternate].filter((v): v is string => Boolean(v));
    const existing = await this.repo.findExisting(phones, body.email ?? null);
    if (existing) throw LeadErrors.exists(await this.existsInfo(existing));

    const source = await this.config.getSource(body.sourceId).catch(() => undefined);
    if (!source || !source.isActive) throw Problems.validation([{ field: 'sourceId', message: 'unknown or inactive lead source' }]);
    if (body.ownerUserId && body.ownerUserId !== p.userId && !p.permissions.has('leads.assign')) {
      throw Problems.forbidden('Only users who can assign leads may choose another owner.');
    }
    if (body.ownerUserId) await this.assertCanReceive(body.ownerUserId);
    if (body.primaryProjectId && !body.projectIds?.includes(body.primaryProjectId)) {
      throw Problems.validation([{ field: 'primaryProjectId', message: 'must be one of projectIds' }]);
    }
    if (!body.countryCode && (await this.features()).mandatory_location) {
      throw Problems.validation([{ field: 'countryCode', message: 'location is required (Global Configuration › Leads)' }]);
    }

    // Every new lead starts as Warm (stakeholder decision 2026-10-17).
    const stage = await this.stageByKey('warm');
    const lead = await this.repo
      .insert({
        ...pickFields(body),
        fullName: body.fullName,
        sourceId: body.sourceId,
        stageId: stage.id,
        stageCategory: stage.category,
        latestNote: body.note ?? null,
        createdBy: p.userId,
      })
      .catch(rethrowReference);
    const inquiry = await this.repo.insertInquiry({
      leadId: lead.id,
      sourceId: body.sourceId,
      campaignId: body.campaignId ?? null,
      eventId: body.eventId ?? null,
      submittedAt: lead.createdAt,
      formAnswers: {},
    });
    await this.repo.addActivity(lead.id, { type: 'inquiry', summary: `Lead added via ${source.name}`, actorUserId: p.userId, links: { inquiryId: inquiry.id } });
    await this.repo.insertStageHistory({ leadId: lead.id, fromStageId: null, toStageId: stage.id, changedBy: p.userId });
    if (body.projectIds?.length) await this.repo.replaceProjects(lead.id, body.projectIds, body.primaryProjectId).catch(rethrowReference);
    if (body.note) await this.repo.addActivity(lead.id, { type: 'note', summary: 'Note added', body: body.note, actorUserId: p.userId });
    await this.audit.record('create', 'leads', lead.id, { fullName: [null, lead.fullName], sourceId: [null, lead.sourceId] });

    if (body.ownerUserId) await this.changeOwner(lead.id, body.ownerUserId, { method: 'manual', actorUserId: p.userId });
    await this.events.publish('lead.created', {
      tenantId: lead.tenantId,
      leadId: lead.id,
      ownerUserId: body.ownerUserId ?? null,
      sourceId: lead.sourceId,
      viaIntake: false,
    });
    const created = (await this.repo.find(lead.id))!;
    return this.toDto(created, (await this.scope.accessFor(p, [created])).get(created.id));
  }

  async update(p: Principal, id: string, body: LeadUpdateDto): Promise<LeadDto> {
    const { lead, access } = await this.editable(p, id);
    if (lead.version !== body.version) throw LeadErrors.versionConflict();
    validateBudget({ ...pickFields(lead as never), ...body });

    const patch: LeadPatch = {};
    for (const key of EDITABLE) if (body[key] !== undefined) (patch as Record<string, unknown>)[key] = body[key];
    if (body.nextFollowUpAt !== undefined) {
      await this.assertDateAllowed(body.nextFollowUpAt, 'nextFollowUpAt');
      patch.nextFollowUpAt = new Date(body.nextFollowUpAt);
    }
    // Lead Source Update: the current source may change; the original stays on the first enquiry and in the audit log.
    if (body.sourceId !== undefined && body.sourceId !== lead.sourceId) {
      if (!(await this.features()).source_update) throw Problems.forbidden('Changing the lead source is turned off (Global Configuration › Leads).');
      const source = await this.config.getSource(body.sourceId).catch(() => undefined);
      if (!source || !source.isActive) throw Problems.validation([{ field: 'sourceId', message: 'unknown or inactive lead source' }]);
      patch.sourceId = body.sourceId;
    }
    const phones = [patch.phonePrimary, patch.phoneAlternate].filter((v): v is string => Boolean(v));
    if (phones.length || patch.email) {
      const clash = await this.repo.findExisting(phones, patch.email ?? null, id);
      if (clash) throw LeadErrors.exists(await this.existsInfo(clash));
    }

    let after = lead;
    if (Object.keys(patch).length) {
      const saved = await this.repo.update(id, patch, body.version).catch(rethrowReference);
      if (!saved) throw LeadErrors.versionConflict();
      after = saved;
    }
    if (body.projectIds) {
      if (body.primaryProjectId && !body.projectIds.includes(body.primaryProjectId)) {
        throw Problems.validation([{ field: 'primaryProjectId', message: 'must be one of projectIds' }]);
      }
      await this.repo.replaceProjects(id, body.projectIds, body.primaryProjectId).catch(rethrowReference);
      if (after === lead) after = (await this.repo.update(id, {}, body.version))!;
    }
    await this.audit.recordUpdate('leads', id, pickAudit(lead), pickAudit(after));
    await this.events.publish('lead.updated', { tenantId: lead.tenantId, leadId: id });
    return this.toDto(after, access);
  }

  async remove(p: Principal, id: string): Promise<void> {
    const { lead } = await this.managed(p, id);
    await this.repo.update(id, { deletedAt: new Date(), deletedBy: p.userId });
    await this.audit.record('delete', 'leads', id, { deletedAt: [null, new Date().toISOString()] });
    await this.events.publish('lead.updated', { tenantId: lead.tenantId, leadId: id });
  }

  async restore(p: Principal, id: string): Promise<LeadDto> {
    const { lead, access } = await this.managed(p, id, { includeDeleted: true });
    if (!lead.deletedAt) return this.toDto(lead, access);
    const after = (await this.repo.update(id, { deletedAt: null, deletedBy: null }))!;
    await this.audit.record('restore', 'leads', id, { deletedAt: [lead.deletedAt.toISOString(), null] });
    await this.events.publish('lead.updated', { tenantId: lead.tenantId, leadId: id });
    return this.toDto(after, access);
  }

  // =================================================================== used by other modules and actions
  /**
   * Changes the owner and logs it (lead_assignments, timeline, lead.assigned). Every assignment path uses this:
   * manual, rules and round-robin, the 10-minute rule, Admin fallback, re-enquiry and user deactivation.
   * A new owner of an open lead gets the response timer (10 minutes by default); Admin fallback does not.
   */
  async changeOwner(leadId: string, toUserId: string | null, change: OwnerChange): Promise<LeadRow> {
    const lead = await this.repo.lock(leadId);
    if (!lead) throw Problems.notFound();
    if (lead.ownerUserId === toUserId) return lead;

    const now = new Date();
    let patch: LeadPatch = { ownerUserId: null, teamId: null, assignedAt: null, responseDueAt: null, firstResponseAt: null };
    if (toUserId) {
      const owner = await this.directory.user(toUserId);
      if (!owner) throw Problems.validation([{ field: 'toUserId', message: 'user not found' }]);
      const timer = lead.stageCategory === 'open' && change.method !== 'admin_fallback';
      const minutes = timer ? (await this.settings.get('leads.response_time')).minutes : 0;
      const due = timer ? new Date(now.getTime() + minutes * 60_000) : null;
      patch = {
        ownerUserId: toUserId,
        teamId: owner.teamId,
        assignedAt: now,
        responseDueAt: due,
        firstResponseAt: null,
        // An open lead with an owner always has a next follow-up (SRS §2.20); the first one is the response deadline.
        nextFollowUpAt: lead.nextFollowUpAt ?? (lead.stageCategory === 'open' ? (due ?? now) : null),
      };
    }
    const after = (await this.repo.update(leadId, patch))!;
    await this.repo.insertAssignment({
      leadId,
      fromUserId: lead.ownerUserId,
      toUserId,
      method: change.method,
      ruleId: change.ruleId ?? null,
      reasonId: change.reasonId ?? null,
      note: change.note ?? null,
      changedBy: change.actorUserId ?? null,
    });
    const names = await this.directory.users([lead.ownerUserId, toUserId].filter((v): v is string => Boolean(v)));
    const from = lead.ownerUserId ? (names.get(lead.ownerUserId)?.fullName ?? 'previous owner') : 'Unassigned';
    const to = toUserId ? (names.get(toUserId)?.fullName ?? 'new owner') : 'Unassigned';
    await this.repo.addActivity(leadId, {
      type: 'owner_change',
      summary: `Owner: ${from} → ${to} (${METHOD_LABEL[change.method]})`,
      body: change.note ?? null,
      actorUserId: change.actorUserId ?? null,
    });
    await this.events.publish('lead.assigned', { tenantId: lead.tenantId, leadId, fromUserId: lead.ownerUserId, toUserId, method: change.method });
    return after;
  }

  /**
   * Any logged action by the owner (call, note, message, stage change, completed task) stops the 10-minute
   * timer (SRS §3.4). Other users' actions only update the last activity time.
   */
  async recordAction(leadId: string, userId: string | null): Promise<void> {
    const lead = await this.repo.find(leadId);
    if (!lead) return;
    const now = new Date();
    const ownerActed = userId !== null && lead.ownerUserId === userId;
    await this.repo.touch(leadId, {
      lastActivityAt: now,
      ...(ownerActed && lead.responseDueAt ? { responseDueAt: null, firstResponseAt: lead.firstResponseAt ?? now } : {}),
    });
    if (ownerActed) await this.events.publish('lead.responded', { tenantId: lead.tenantId, leadId, userId: userId! });
  }

  async addActivity(leadId: string, input: ActivityInput) {
    return this.repo.addActivity(leadId, input);
  }

  /** The lead wrote to us (WhatsApp reply, email): keeps the last inbound time used by lists and reports. */
  async recordInbound(leadId: string, at: Date = new Date()): Promise<void> {
    await this.repo.touch(leadId, { lastInboundAt: at, lastActivityAt: at });
  }

  /** Which of these source submission IDs were already imported through the integration (Meta check, SRS §8.7). */
  async knownSubmissions(integrationId: string, externalSubmissionIds: string[]): Promise<string[]> {
    return this.repo.knownSubmissions(integrationId, externalSubmissionIds);
  }

  /** The lead with this phone or email in the tenant (not limited to a user's scope), if any. */
  async findByContact(phone: string | null, email: string | null): Promise<LeadRow | undefined> {
    return this.repo.findExisting(phone ? [phone] : [], email);
  }

  async findRow(leadId: string): Promise<LeadRow | undefined> {
    return this.repo.find(leadId);
  }

  async setNextFollowUp(leadId: string, at: Date | null): Promise<void> {
    const lead = await this.repo.find(leadId);
    if (!lead) return;
    // Open leads with an owner keep a follow-up date (database rule); without a planned action it stays as it was.
    if (at === null && lead.stageCategory === 'open' && lead.ownerUserId) return;
    await this.repo.touch(leadId, { nextFollowUpAt: at });
  }

  /** Worker scan across tenants: open leads whose owner has not acted within the response time (10-minute rule). */
  async responseOverdue(limit: number): Promise<{ id: string; tenantId: string; ownerUserId: string }[]> {
    const rows = await this.workerDb.db
      .select({ id: leads.id, tenantId: leads.tenantId, ownerUserId: leads.ownerUserId })
      .from(leads)
      .where(and(isNotNull(leads.responseDueAt), lt(leads.responseDueAt, new Date()), isNotNull(leads.ownerUserId), eq(leads.stageCategory, 'open'), isNull(leads.deletedAt)))
      .orderBy(asc(leads.responseDueAt))
      .limit(limit);
    return rows as { id: string; tenantId: string; ownerUserId: string }[];
  }

  /** Worker: leads created per tenant on one UTC day (tenant usage for the owner console). */
  async createdPerTenant(day: string): Promise<Map<string, number>> {
    const start = dayStart(day);
    const rows = await this.workerDb.db
      .select({ tenantId: leads.tenantId, n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(gte(leads.createdAt, start), lt(leads.createdAt, dayAfter(day))))
      .groupBy(leads.tenantId);
    return new Map(rows.map((r) => [r.tenantId, r.n]));
  }

  /** What assignment rules match on (SRS §4.8): project, campaign, source, language, location. */
  async assignmentFacts(leadId: string) {
    const lead = await this.repo.find(leadId);
    if (!lead) return undefined;
    const projects = (await this.repo.projectsOf([leadId])).get(leadId)?.projectIds ?? [];
    return { lead, projectIds: projects };
  }

  /** Users who already missed this lead under the 10-minute rule since it was last assigned by hand. */
  async missedBy(leadId: string): Promise<string[]> {
    return this.repo.missedBy(leadId);
  }

  /** Inputs of the lead score (SRS §2.24): budget, projects, source quality, engagement on the timeline. */
  async scoringFacts(leadId: string) {
    const lead = await this.repo.find(leadId);
    if (!lead) return undefined;
    const source = await this.config.getSource(lead.sourceId);
    const projects = (await this.repo.projectsOf([leadId])).get(leadId)?.projectIds ?? [];
    const [counts] = await this.db.current
      .select({
        answeredCalls: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'call' AND ${activities.summary} = 'Call: Answered')::int`,
        notes: sql<number>`count(*) FILTER (WHERE ${activities.type} = 'note')::int`,
        inbound: sql<number>`count(*) FILTER (WHERE ${activities.type} IN ('whatsapp', 'email', 'meeting', 'viewing'))::int`,
      })
      .from(activities)
      .where(eq(activities.leadId, leadId));
    return { lead, sourceQuality: source.qualityScore, projectCount: projects.length, ...(counts ?? { answeredCalls: 0, notes: 0, inbound: 0 }) };
  }

  async setScore(leadId: string, score: number): Promise<void> {
    await this.repo.touch(leadId, { score });
  }

  async assertCanReceive(userId: string): Promise<void> {
    const user = await this.directory.user(userId);
    if (!user || user.status !== 'active') throw Problems.validation([{ field: 'toUserId', message: 'the user is not active' }]);
    if (!user.receivesLeads) throw LeadErrors.notReceivingLeads();
  }

  async stageByKey(key: string) {
    const stage = await this.config.stageByKey(key);
    if (!stage) throw new Error(`Stage ${key} is missing for this tenant (create_tenant_defaults sets it)`);
    return stage;
  }

  // =================================================================== helpers
  private async existsInfo(lead: LeadRow): Promise<LeadExistsDto> {
    const [owner, stage] = await Promise.all([
      lead.ownerUserId ? this.directory.user(lead.ownerUserId) : undefined,
      this.config.getStage(lead.stageId),
    ]);
    return { leadId: lead.id, ownerUserId: lead.ownerUserId, ownerName: owner?.fullName ?? null, stageName: stage.name };
  }

  private async withSavedFilter(p: Principal, query: LeadListQuery): Promise<LeadListQuery> {
    if (!query.savedFilterId) return query;
    const myTeam = (await this.directory.user(p.userId))?.teamId ?? null;
    const [filter] = await this.db.current
      .select()
      .from(savedFilters)
      .where(
        and(
          eq(savedFilters.id, query.savedFilterId),
          eq(savedFilters.entity, 'leads'),
          or(eq(savedFilters.ownerUserId, p.userId), myTeam ? eq(savedFilters.sharedTeamId, myTeam) : undefined),
        ),
      )
      .limit(1);
    if (!filter) throw Problems.validation([{ field: 'savedFilterId', message: 'saved filter not found' }]);
    const saved = Object.fromEntries(Object.entries(filter.filters).filter(([k]) => k in SAVED_FILTER_KEYS)) as Partial<LeadListQuery>;
    const fromQuery = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)) as LeadListQuery;
    return { ...saved, sort: filter.sort.length ? filter.sort.join(',') : undefined, ...fromQuery };
  }

  private async conditions(p: Principal, f: LeadListQuery): Promise<(SQL | undefined)[]> {
    const tab = f.tab ?? 'all';
    if (tab === 'deleted' && !p.permissions.has('leads.delete')) throw Problems.forbidden('Only users who can delete leads see the Deleted tab.');
    const c: (SQL | undefined)[] = [tab === 'deleted' ? isNotNull(leads.deletedAt) : isNull(leads.deletedAt)];
    const now = new Date();
    switch (tab) {
      case 'my':
        c.push(eq(leads.ownerUserId, p.userId));
        break;
      case 'shared':
        c.push(sql`EXISTS (SELECT 1 FROM ${leadShares} WHERE ${leadShares.leadId} = ${leads.id} AND ${leadShares.userId} = ${p.userId})`);
        break;
      case 'team': {
        const teamIds = new Set(p.dataScope === 'team' || p.dataScope === 'division' ? await this.directory.scopeTeamIds(p.userId, p.dataScope) : []);
        const own = (await this.directory.user(p.userId))?.teamId;
        if (own) teamIds.add(own);
        c.push(teamIds.size ? inArray(leads.teamId, [...teamIds]) : sql`false`);
        break;
      }
      case 'unassigned':
        c.push(isNull(leads.ownerUserId), eq(leads.stageCategory, 'open'));
        break;
      case 'hot':
      case 'warm':
      case 'cold':
      case 'sale_done':
        c.push(eq(leads.stageId, (await this.stageByKey(tab)).id));
        break;
      case 'scheduled':
        c.push(eq(leads.stageCategory, 'open'), gte(leads.nextFollowUpAt, now));
        break;
      case 'overdue':
        c.push(eq(leads.stageCategory, 'open'), isNotNull(leads.ownerUserId), lt(leads.nextFollowUpAt, now));
        break;
    }
    if (f.q) {
      const q = f.q.trim();
      const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      const digits = q.replace(/[^\d+]/g, '');
      c.push(
        or(
          ilike(leads.fullName, like),
          ilike(leads.email, like),
          digits.length >= 3 ? or(sql`${leads.phonePrimary} LIKE ${`%${digits}%`}`, sql`${leads.phoneAlternate} LIKE ${`%${digits}%`}`) : undefined,
        ),
      );
    }
    if (f.stageId) c.push(eq(leads.stageId, f.stageId));
    if (f.substatusId) c.push(eq(leads.substatusId, f.substatusId));
    if (f.ownerUserId) c.push(eq(leads.ownerUserId, f.ownerUserId));
    if (f.teamId) c.push(eq(leads.teamId, f.teamId));
    if (f.sourceId) c.push(eq(leads.sourceId, f.sourceId));
    if (f.campaignId) c.push(eq(leads.campaignId, f.campaignId));
    if (f.eventId) c.push(eq(leads.eventId, f.eventId));
    if (f.projectId) {
      c.push(sql`EXISTS (SELECT 1 FROM ${leadProjects} WHERE ${leadProjects.leadId} = ${leads.id} AND ${leadProjects.projectId} = ${f.projectId})`);
    }
    // Budget ranges overlap the requested range.
    if (f.budgetMin) c.push(sql`coalesce(${leads.budgetMax}, ${leads.budgetMin}) >= ${f.budgetMin}`);
    if (f.budgetMax) c.push(sql`coalesce(${leads.budgetMin}, ${leads.budgetMax}) <= ${f.budgetMax}`);
    if (f.createdFrom) c.push(gte(leads.createdAt, dayStart(f.createdFrom)));
    if (f.createdTo) c.push(lt(leads.createdAt, dayAfter(f.createdTo)));
    return c;
  }

  private orderBy(sort: string): SQL[] {
    const parts = sort.split(',').map((s) => s.trim()).filter(Boolean);
    const order: SQL[] = [];
    for (const part of parts) {
      const descending = part.startsWith('-');
      const column = SORTABLE[part.replace(/^-/, '') as keyof typeof SORTABLE];
      if (!column) throw Problems.validation([{ field: 'sort', message: `cannot sort by ${part}` }]);
      order.push(descending ? sql`${column} DESC NULLS LAST` : sql`${column} ASC NULLS LAST`);
    }
    order.push(asc(leads.id));
    return order;
  }
}

const SAVED_FILTER_KEYS = {
  tab: 1,
  q: 1,
  stageId: 1,
  ownerUserId: 1,
  teamId: 1,
  projectId: 1,
  sourceId: 1,
  campaignId: 1,
  eventId: 1,
  budgetMin: 1,
  budgetMax: 1,
  createdFrom: 1,
  createdTo: 1,
};

const METHOD_LABEL: Record<AssignmentMethod, string> = {
  manual: 'manual',
  round_robin: 'round-robin',
  rule: 'assignment rule',
  no_response: 'No response from agent',
  admin_fallback: 'Whole team did not respond',
  user_deactivated: 'user deactivated',
  re_enquiry: 're-enquiry',
};

function pickFields(body: Partial<Record<(typeof EDITABLE)[number], unknown>>): Partial<LeadRow> {
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE) if (body[key] !== undefined && key !== 'fullName') out[key] = body[key];
  return out as Partial<LeadRow>;
}

function pickAudit(l: LeadRow): Record<string, unknown> {
  const row = l as unknown as Record<string, unknown>;
  return Object.fromEntries(
    [...EDITABLE, 'sourceId', 'nextFollowUpAt'].map((k) => {
      const value = row[k];
      return [k, value instanceof Date ? value.toISOString() : value];
    }),
  );
}

function validateBudget(b: { budgetMin?: string | null; budgetMax?: string | null; budgetCurrency?: string | null }): void {
  const errors: { field: string; message: string }[] = [];
  if ((b.budgetMin || b.budgetMax) && !b.budgetCurrency) errors.push({ field: 'budgetCurrency', message: 'required when a budget is given' });
  if (b.budgetMin && Number(b.budgetMin) < 0) errors.push({ field: 'budgetMin', message: 'cannot be negative' });
  if (b.budgetMin && b.budgetMax && Number(b.budgetMax) < Number(b.budgetMin)) errors.push({ field: 'budgetMax', message: 'must be at least budgetMin' });
  if (errors.length) throw Problems.validation(errors);
}

/** A linked record (campaign, event, project, currency) that does not exist in this tenant → 400. */
function rethrowReference(err: unknown): never {
  if (pgCode(err) === PG_FOREIGN_KEY_VIOLATION) throw Problems.validation([{ field: 'id', message: 'a linked record (campaign, event, project or currency) does not exist' }]);
  throw err;
}

const hideText = (v: string | undefined, keep: number): string | undefined =>
  v === undefined ? undefined : v.length <= keep + 2 ? '•'.repeat(v.length) : v.slice(0, keep) + '•'.repeat(Math.max(3, v.length - keep - 2)) + v.slice(-2);

/** Masks phone numbers and email (Hide Lead Contact Info): +971•••••67, a•••@example.com. */
export function maskContact(dto: LeadDto, hide: boolean): LeadDto {
  if (!hide) return dto;
  const [user, domain] = (dto.email ?? '').split('@');
  return {
    ...dto,
    phonePrimary: hideText(dto.phonePrimary, 4),
    phoneAlternate: hideText(dto.phoneAlternate, 4),
    email: dto.email ? `${(user ?? '').slice(0, 1)}•••@${domain ?? ''}` : undefined,
    contactHidden: true,
  };
}
