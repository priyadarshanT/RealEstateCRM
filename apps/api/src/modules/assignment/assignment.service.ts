import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { DbService } from '../../core/database/db.service';
import { Problems } from '../../core/errors/problem';
import { pgCode, PG_FOREIGN_KEY_VIOLATION } from '../../core/errors/pg';
import { EventBus } from '../../core/events/domain-events';
import { LeadsService } from '../leads/leads.service';
import { OrganizationDirectory, UserSummary } from '../organization/directory.service';
import { LeadConfigService } from '../settings/lead-config.service';
import { assignmentRuleMembers, assignmentRules, RuleConditions, RuleRow } from './assignment.schema';
import { AssignmentStrategy, isAvailable, RoundRobinStrategy } from './assignment.strategy';
import { AssignmentRuleDto, AssignmentRuleInputDto, RuleConditionsDto } from './dto/rule.dto';

/**
 * Lead assignment (SRS §3.4–3.7, §4.8–4.10):
 * - new leads (and re-enquiries whose agent is gone) go through the rules top to bottom; the first rule that
 *   matches picks the next available agent round-robin from its team or members; no match → Unassigned;
 * - the 10-minute rule moves a lead nobody acted on to the next available agent in the same team, and once the
 *   whole team has missed it, to the Admin.
 */
@Injectable()
export class AssignmentService implements OnModuleInit {
  private readonly logger = new Logger(AssignmentService.name);
  private readonly strategy: AssignmentStrategy = new RoundRobinStrategy();

  constructor(
    private readonly db: DbService,
    private readonly leads: LeadsService,
    private readonly directory: OrganizationDirectory,
    private readonly config: LeadConfigService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.on('lead.created', async (e) => {
      if (!e.ownerUserId) await this.autoAssign(e.leadId, []);
    });
    this.events.on('lead.needs_owner', async (e) => {
      const assigned = await this.autoAssign(e.leadId, e.excludeUserIds, e.method);
      if (!assigned) await this.leads.changeOwner(e.leadId, null, { method: e.method, note: 'No assignment rule matched' });
    });
    this.events.on('lead.no_response', (e) => this.escalate(e.leadId, e.userId));
  }

  // =================================================================== automatic assignment
  /** Runs the rules; returns the chosen agent, or undefined when the lead stays Unassigned. */
  async autoAssign(leadId: string, excludeUserIds: string[], method?: 're_enquiry' | 'user_deactivated'): Promise<string | undefined> {
    const facts = await this.leads.assignmentFacts(leadId);
    if (!facts || facts.lead.stageCategory !== 'open' || facts.lead.deletedAt) return undefined;
    const rules = await this.db.current.select().from(assignmentRules).where(eq(assignmentRules.isActive, true)).orderBy(asc(assignmentRules.priority));
    for (const rule of rules) {
      if (!matches(rule.conditions, facts.lead, facts.projectIds)) continue;
      const pool = (await this.poolOf(rule)).filter((u) => !excludeUserIds.includes(u.id) && (!rule.respectAvailability || isAvailable(u)));
      const chosen = this.strategy.pick(pool, rule.lastAssignedUserId);
      if (!chosen) continue;
      await this.db.current.update(assignmentRules).set({ lastAssignedUserId: chosen.id }).where(eq(assignmentRules.id, rule.id));
      await this.leads.changeOwner(leadId, chosen.id, { method: method ?? (hasConditions(rule.conditions) ? 'rule' : 'round_robin'), ruleId: rule.id });
      return chosen.id;
    }
    return undefined;
  }

  /**
   * 10-minute rule (SRS §3.5–3.7): the owner did not act in time. Next available agent in the same team who has
   * not missed it yet; when the whole team has missed it, the Admin becomes the owner (no timer).
   */
  async escalate(leadId: string, missedUserId: string): Promise<void> {
    const lead = await this.leads.findRow(leadId);
    if (!lead || lead.ownerUserId !== missedUserId || !lead.responseDueAt || lead.stageCategory !== 'open' || lead.deletedAt) return;
    const missed = new Set([...(await this.leads.missedBy(leadId)), missedUserId]);
    const teamId = lead.teamId ?? (await this.directory.user(missedUserId))?.teamId ?? null;
    const team = teamId ? await this.directory.teamMembers(teamId) : [];
    const candidates = team.filter((u) => isAvailable(u) && !missed.has(u.id));
    const next = this.strategy.pick(candidates, missedUserId);
    if (next) {
      const reason = await this.config.reasonByKey('reassignment', 'no_response');
      await this.leads.changeOwner(leadId, next.id, { method: 'no_response', reasonId: reason?.id ?? null, note: 'No response from agent' });
      return;
    }
    const admin = (await this.directory.admins())[0];
    if (!admin) {
      this.logger.warn(`lead ${leadId}: no admin to fall back to`);
      return;
    }
    const reason = await this.config.reasonByKey('reassignment', 'admin_fallback');
    await this.leads.changeOwner(leadId, admin.id, { method: 'admin_fallback', reasonId: reason?.id ?? null, note: 'Whole team did not respond' });
  }

  private async poolOf(rule: RuleRow): Promise<UserSummary[]> {
    if (rule.targetTeamId) return this.directory.teamMembers(rule.targetTeamId);
    const members = await this.db.current.select({ userId: assignmentRuleMembers.userId }).from(assignmentRuleMembers).where(eq(assignmentRuleMembers.ruleId, rule.id));
    return [...(await this.directory.users(members.map((m) => m.userId))).values()];
  }

  // =================================================================== rules (Settings → assignment rules)
  async list(): Promise<AssignmentRuleDto[]> {
    const rules = await this.db.current.select().from(assignmentRules).orderBy(asc(assignmentRules.priority));
    const members = await this.membersOf(rules.map((r) => r.id));
    return rules.map((r) => AssignmentRuleDto.from(r, members.get(r.id) ?? []));
  }

  async create(body: AssignmentRuleInputDto): Promise<AssignmentRuleDto> {
    if (!body.name) throw Problems.validation([{ field: 'name', message: 'name is required' }]);
    if (!body.conditions) throw Problems.validation([{ field: 'conditions', message: 'conditions are required' }]);
    this.assertPool(body.targetTeamId ?? null, body.memberUserIds ?? []);
    const tenantId = this.db.currentTenantId!;
    const count = await this.ruleCount();
    const priority = Math.min(body.priority ?? count + 1, count + 1);
    // Make room: rules at or after this position move down one (the unique priority is checked at commit).
    await this.db.current.update(assignmentRules).set({ priority: sql`${assignmentRules.priority} + 1` }).where(sql`${assignmentRules.priority} >= ${priority}`);
    const [rule] = await this.db.current
      .insert(assignmentRules)
      .values({
        tenantId,
        name: body.name,
        priority,
        conditions: toStored(body.conditions),
        targetTeamId: body.targetTeamId ?? null,
        respectAvailability: body.respectAvailability ?? true,
        isActive: body.isActive ?? true,
      })
      .returning()
      .catch(rethrowReference);
    await this.replaceMembers(rule!.id, body.targetTeamId ? [] : (body.memberUserIds ?? []));
    await this.audit.record('setting_change', 'assignment_rules', rule!.id, { name: [null, rule!.name], priority: [null, priority] });
    return AssignmentRuleDto.from(rule!, body.targetTeamId ? [] : (body.memberUserIds ?? []));
  }

  async update(id: string, body: AssignmentRuleInputDto): Promise<AssignmentRuleDto> {
    const before = await this.find(id);
    const targetTeamId = body.targetTeamId !== undefined ? body.targetTeamId : before.targetTeamId;
    const members = body.memberUserIds ?? (await this.membersOf([id])).get(id) ?? [];
    this.assertPool(targetTeamId, members);
    if (body.priority !== undefined && body.priority !== before.priority) await this.move(id, body.priority);
    const [after] = await this.db.current
      .update(assignmentRules)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.conditions !== undefined ? { conditions: toStored(body.conditions) } : {}),
        ...(body.targetTeamId !== undefined ? { targetTeamId: body.targetTeamId } : {}),
        ...(body.respectAvailability !== undefined ? { respectAvailability: body.respectAvailability } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(assignmentRules.id, id))
      .returning()
      .catch(rethrowReference);
    if (body.memberUserIds !== undefined || body.targetTeamId) await this.replaceMembers(id, targetTeamId ? [] : members);
    await this.audit.recordUpdate('assignment_rules', id, ruleAudit(before), ruleAudit(after!), 'setting_change');
    return AssignmentRuleDto.from(after!, targetTeamId ? [] : members);
  }

  async delete(id: string): Promise<void> {
    const rule = await this.find(id);
    await this.db.current.delete(assignmentRules).where(eq(assignmentRules.id, id)).catch((err) => {
      if (pgCode(err) === PG_FOREIGN_KEY_VIOLATION) {
        // Lead history keeps a link to the rule that assigned it: switch it off instead.
        throw Problems.validation([{ field: 'id', message: 'this rule has assigned leads; make it inactive instead' }]);
      }
      throw err;
    });
    await this.db.current.update(assignmentRules).set({ priority: sql`${assignmentRules.priority} - 1` }).where(sql`${assignmentRules.priority} > ${rule.priority}`);
    await this.audit.record('setting_change', 'assignment_rules', id, { name: [rule.name, null] });
  }

  /** PUT /assignment-rules/order: the full list of rule IDs in the new order. */
  async reorder(ruleIds: string[]): Promise<void> {
    const rules = await this.db.current.select({ id: assignmentRules.id }).from(assignmentRules);
    const known = new Set(rules.map((r) => r.id));
    if (ruleIds.length !== known.size || ruleIds.some((id) => !known.has(id))) {
      throw Problems.validation([{ field: 'ruleIds', message: 'send every rule ID exactly once' }]);
    }
    for (const [i, id] of ruleIds.entries()) {
      await this.db.current.update(assignmentRules).set({ priority: i + 1 }).where(eq(assignmentRules.id, id));
    }
    await this.audit.record('setting_change', 'assignment_rules', null, { order: [null, ruleIds] });
  }

  private async move(id: string, to: number): Promise<void> {
    const ordered = (await this.db.current.select({ id: assignmentRules.id }).from(assignmentRules).orderBy(asc(assignmentRules.priority))).map((r) => r.id);
    const rest = ordered.filter((r) => r !== id);
    rest.splice(Math.min(to, ordered.length) - 1, 0, id);
    for (const [i, ruleId] of rest.entries()) await this.db.current.update(assignmentRules).set({ priority: i + 1 }).where(eq(assignmentRules.id, ruleId));
  }

  private async find(id: string): Promise<RuleRow> {
    const [rule] = await this.db.current.select().from(assignmentRules).where(eq(assignmentRules.id, id)).limit(1);
    if (!rule) throw Problems.notFound();
    return rule;
  }

  private async ruleCount(): Promise<number> {
    const [row] = await this.db.current.select({ n: sql<number>`count(*)::int` }).from(assignmentRules);
    return row?.n ?? 0;
  }

  private async membersOf(ruleIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (!ruleIds.length) return result;
    const rows = await this.db.current.select().from(assignmentRuleMembers).where(inArray(assignmentRuleMembers.ruleId, ruleIds));
    for (const r of rows) result.set(r.ruleId, [...(result.get(r.ruleId) ?? []), r.userId]);
    return result;
  }

  private async replaceMembers(ruleId: string, userIds: string[]): Promise<void> {
    await this.db.current.delete(assignmentRuleMembers).where(eq(assignmentRuleMembers.ruleId, ruleId));
    if (userIds.length) {
      await this.db.current
        .insert(assignmentRuleMembers)
        .values(userIds.map((userId) => ({ tenantId: this.db.currentTenantId!, ruleId, userId })))
        .catch(rethrowReference);
    }
  }

  private assertPool(targetTeamId: string | null, members: string[]): void {
    if (!targetTeamId && !members.length) throw Problems.validation([{ field: 'targetTeamId', message: 'choose a team or at least one member' }]);
  }
}

/** Every condition that is set must match (an empty list means "any"). */
function matches(c: RuleConditions, lead: { sourceId: string; campaignId: string | null; preferredLanguage: string | null; countryCode: string | null }, projectIds: string[]): boolean {
  if (c.source_ids?.length && !c.source_ids.includes(lead.sourceId)) return false;
  if (c.campaign_ids?.length && (!lead.campaignId || !c.campaign_ids.includes(lead.campaignId))) return false;
  if (c.project_ids?.length && !projectIds.some((p) => c.project_ids!.includes(p))) return false;
  if (c.languages?.length && (!lead.preferredLanguage || !c.languages.map((l) => l.toLowerCase()).includes(lead.preferredLanguage.toLowerCase()))) return false;
  if (c.locations?.length && (!lead.countryCode || !c.locations.map((l) => l.toUpperCase()).includes(lead.countryCode.toUpperCase()))) return false;
  return true;
}

function hasConditions(c: RuleConditions): boolean {
  return Boolean(c.source_ids?.length || c.campaign_ids?.length || c.project_ids?.length || c.languages?.length || c.locations?.length);
}

/** Stored with the snake_case keys documented in db/schema.sql (assignment_rules.conditions). */
function toStored(c: RuleConditionsDto): RuleConditions {
  const stored: RuleConditions = {};
  if (c.projectIds?.length) stored.project_ids = c.projectIds;
  if (c.campaignIds?.length) stored.campaign_ids = c.campaignIds;
  if (c.sourceIds?.length) stored.source_ids = c.sourceIds;
  if (c.languages?.length) stored.languages = c.languages;
  if (c.locations?.length) stored.locations = c.locations;
  return stored;
}

function ruleAudit(r: RuleRow) {
  return { name: r.name, priority: r.priority, conditions: r.conditions, targetTeamId: r.targetTeamId, respectAvailability: r.respectAvailability, isActive: r.isActive };
}

function rethrowReference(err: unknown): never {
  if (pgCode(err) === PG_FOREIGN_KEY_VIOLATION) throw Problems.validation([{ field: 'id', message: 'the team or a member does not exist' }]);
  throw err;
}

