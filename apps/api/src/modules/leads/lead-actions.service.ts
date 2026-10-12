import { Injectable, OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { ProblemException, Problems } from '../../core/errors/problem';
import { pgCode, PG_FOREIGN_KEY_VIOLATION } from '../../core/errors/pg';
import { EventBus } from '../../core/events/domain-events';
import { decodeCursor, encodeCursor } from '../../core/http/pagination';
import { RequestContext } from '../../core/http/request-context';
import { FilesService } from '../../core/files/files.service';
import { OrganizationDirectory } from '../organization/directory.service';
import { LeadConfigService } from '../settings/lead-config.service';
import {
  ActivityDto,
  ActivityPage,
  AssignDto,
  AttachFileDto,
  AttachmentDto,
  BulkLeadActionDto,
  BulkResultDto,
  InquiryDto,
  LeadDto,
  LeadShareDto,
  NoteDto,
  PriorityDto,
  SetProjectsDto,
  ShareDto,
  StageChangeDto,
  TimelineQuery,
} from './dto/lead.dto';
import { canEdit, LeadScope } from './lead-scope';
import { LeadErrors } from './leads.errors';
import { LeadsRepository } from './leads.repository';
import { ACTIVITY_TYPES, ActivityType, LeadRow } from './leads.schema';
import { LeadsService } from './leads.service';

/** Actions on a lead from the lead page (SRS §2.13–2.23): stage, owner, notes, priority, projects, sharing, files. */
@Injectable()
export class LeadActionsService implements OnModuleInit {
  constructor(
    private readonly leads: LeadsService,
    private readonly repo: LeadsRepository,
    private readonly scope: LeadScope,
    private readonly config: LeadConfigService,
    private readonly directory: OrganizationDirectory,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly db: DbService,
  ) {}

  onModuleInit(): void {
    // Who may see and change a lead's attachments (download links, DELETE /attachments/{id}).
    this.files.registerAccess('lead', {
      canView: async (leadId) => this.accessOfCurrentUser(leadId).then((a) => a !== undefined),
      canEdit: async (leadId) => this.accessOfCurrentUser(leadId).then((a) => canEdit(a)),
    });
  }

  // =================================================================== stage
  async changeStage(p: Principal, id: string, body: StageChangeDto): Promise<LeadDto> {
    const { lead, access } = await this.leads.editable(p, id);
    const after = await this.applyStage(lead, body, p.userId, false);
    return this.leads.toDto(after, access);
  }

  /** Moves a lead to a stage with the rules of SRS §2.19–2.22. Also used for automatic changes (re-enquiry reopen). */
  async applyStage(lead: LeadRow, body: StageChangeDto, actorUserId: string | null, automatic: boolean): Promise<LeadRow> {
    const stage = await this.config.getStage(body.stageId).catch(() => undefined);
    if (!stage || !stage.isActive) throw Problems.validation([{ field: 'stageId', message: 'unknown or inactive stage' }]);
    if (stage.id === lead.stageId) return lead;

    const closing = stage.category === 'lost' || stage.category === 'invalid';
    if (closing) {
      if (!body.reasonId) throw LeadErrors.reasonRequired(`A reason is required to move a lead to ${stage.name}.`);
      const reason = await this.config.getReason(body.reasonId).catch(() => undefined);
      if (!reason || !reason.isActive || reason.type !== stage.category) {
        throw Problems.validation([{ field: 'reasonId', message: `choose an active ${stage.category} reason` }]);
      }
    }
    const nextFollowUpAt = body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : lead.nextFollowUpAt;
    if (stage.category === 'open' && lead.ownerUserId && !nextFollowUpAt) throw LeadErrors.nextActionRequired();

    const now = new Date();
    const after = (await this.repo.update(lead.id, {
      stageId: stage.id,
      stageCategory: stage.category,
      closeReasonId: closing ? body.reasonId! : null,
      closeNote: closing ? (body.note ?? null) : null,
      closedAt: stage.category === 'open' ? null : (lead.closedAt ?? now),
      nextFollowUpAt,
      // A closed lead has nothing to respond to.
      ...(stage.category !== 'open' ? { responseDueAt: null } : {}),
    }))!;
    await this.repo.insertStageHistory({
      leadId: lead.id,
      fromStageId: lead.stageId,
      toStageId: stage.id,
      reasonId: closing ? body.reasonId! : null,
      note: body.note ?? null,
      isAutomatic: automatic,
      changedBy: actorUserId,
    });
    const from = await this.config.getStage(lead.stageId);
    await this.repo.addActivity(lead.id, { type: 'stage_change', summary: `Stage: ${from.name} → ${stage.name}`, body: body.note ?? null, actorUserId });
    await this.audit.record('update', 'leads', lead.id, { stageId: [lead.stageId, stage.id] });
    await this.events.publish('lead.stage_changed', { tenantId: lead.tenantId, leadId: lead.id, fromStageId: lead.stageId, toStageId: stage.id, category: stage.category });
    if (!automatic) await this.leads.recordAction(lead.id, actorUserId);
    return (await this.repo.find(lead.id))!;
  }

  // =================================================================== owner
  /** Manual assign / reassign (SRS §4.10): reason required when the lead already has an owner. */
  async assign(p: Principal, id: string, body: AssignDto): Promise<LeadDto> {
    const { lead, access } = await this.leads.managed(p, id);
    await this.validateAssign(lead, body.toUserId, body.reasonId);
    const after = await this.leads.changeOwner(id, body.toUserId, { method: 'manual', actorUserId: p.userId, reasonId: body.reasonId ?? null, note: body.note ?? null });
    await this.audit.record('update', 'leads', id, { ownerUserId: [lead.ownerUserId, body.toUserId] });
    return this.leads.toDto(after, (await this.scope.accessFor(p, [after])).get(id) ?? access);
  }

  private async validateAssign(lead: LeadRow, toUserId: string, reasonId?: string): Promise<void> {
    if (lead.ownerUserId === toUserId) throw LeadErrors.invalidState('The lead is already owned by this user.');
    await this.leads.assertCanReceive(toUserId);
    if (lead.ownerUserId) {
      if (!reasonId) throw LeadErrors.reasonRequired('A reason is required to reassign a lead.');
      const reason = await this.config.getReason(reasonId).catch(() => undefined);
      if (!reason || !reason.isActive || reason.type !== 'reassignment') {
        throw Problems.validation([{ field: 'reasonId', message: 'choose an active reassignment reason' }]);
      }
    }
  }

  // =================================================================== notes, priority, projects
  async addNote(p: Principal, id: string, body: NoteDto): Promise<ActivityDto> {
    await this.leads.editable(p, id);
    const activity = await this.repo.addActivity(id, { type: 'note', summary: 'Note added', body: body.body, actorUserId: p.userId });
    await this.repo.touch(id, { latestNote: body.body.slice(0, 2000) });
    await this.leads.recordAction(id, p.userId);
    return ActivityDto.from(activity);
  }

  async setPriority(p: Principal, id: string, body: PriorityDto): Promise<LeadDto> {
    const { lead, access } = await this.leads.editable(p, id);
    if (lead.priority === body.priority) return this.leads.toDto(lead, access);
    const after = (await this.repo.update(id, { priority: body.priority }))!;
    await this.audit.record('update', 'leads', id, { priority: [lead.priority, body.priority] });
    return this.leads.toDto(after, access);
  }

  async setProjects(p: Principal, id: string, body: SetProjectsDto): Promise<LeadDto> {
    const { access } = await this.leads.editable(p, id);
    if (body.primaryProjectId && !body.projectIds.includes(body.primaryProjectId)) {
      throw Problems.validation([{ field: 'primaryProjectId', message: 'must be one of projectIds' }]);
    }
    const before = (await this.repo.projectsOf([id])).get(id)?.projectIds ?? [];
    await this.repo.replaceProjects(id, body.projectIds, body.primaryProjectId).catch((err) => {
      if (pgCode(err) === PG_FOREIGN_KEY_VIOLATION) throw Problems.validation([{ field: 'projectIds', message: 'unknown project' }]);
      throw err;
    });
    const after = (await this.repo.update(id, {}))!;
    await this.audit.record('update', 'leads', id, { projectIds: [before, body.projectIds] });
    await this.events.publish('lead.updated', { tenantId: after.tenantId, leadId: id });
    return this.leads.toDto(after, access);
  }

  // =================================================================== sharing (SRS §2.16–2.18)
  async listShares(p: Principal, id: string): Promise<LeadShareDto[]> {
    await this.leads.visible(p, id);
    const shares = await this.repo.shares(id);
    const names = await this.directory.users(shares.map((s) => s.userId));
    return shares.map((s) => ({ userId: s.userId, userName: names.get(s.userId)?.fullName, access: s.access, sharedBy: s.sharedBy, sharedAt: s.sharedAt.toISOString() }));
  }

  async share(p: Principal, id: string, body: ShareDto): Promise<LeadShareDto> {
    const { lead } = await this.leads.managed(p, id);
    if (body.userId === lead.ownerUserId) throw LeadErrors.invalidState('The owner already has full access.');
    const user = await this.directory.user(body.userId);
    if (!user || user.status !== 'active') throw Problems.validation([{ field: 'userId', message: 'the user is not active' }]);
    const share = await this.repo.upsertShare(id, body.userId, body.access, p.userId);
    await this.repo.addActivity(id, { type: 'share', summary: `Shared with ${user.fullName} (${body.access === 'edit' ? 'can edit' : 'view only'})`, actorUserId: p.userId });
    await this.audit.record('update', 'lead_shares', id, { [body.userId]: [null, body.access] });
    await this.events.publish('lead.shared', { tenantId: lead.tenantId, leadId: id, userId: body.userId, access: body.access, sharedBy: p.userId });
    return { userId: share.userId, userName: user.fullName, access: share.access, sharedBy: share.sharedBy, sharedAt: share.sharedAt.toISOString() };
  }

  async unshare(p: Principal, id: string, userId: string): Promise<void> {
    await this.leads.managed(p, id);
    const before = (await this.repo.shares(id)).find((s) => s.userId === userId);
    if (!before || !(await this.repo.deleteShare(id, userId))) throw Problems.notFound();
    const user = await this.directory.user(userId);
    await this.repo.addActivity(id, { type: 'share', summary: `Sharing removed for ${user?.fullName ?? 'a user'}`, actorUserId: p.userId });
    await this.audit.record('update', 'lead_shares', id, { [userId]: [before.access, null] });
  }

  // =================================================================== files
  async listAttachments(p: Principal, id: string): Promise<AttachmentDto[]> {
    await this.leads.visible(p, id);
    const rows = await this.files.listAttachments({ type: 'lead', id });
    return rows.map((a) => ({ id: a.id, fileId: a.fileId, fileName: a.fileName, category: a.category, createdAt: a.createdAt.toISOString() }));
  }

  async attach(p: Principal, id: string, body: AttachFileDto): Promise<AttachmentDto> {
    await this.leads.editable(p, id);
    const a = await this.files.attach({ type: 'lead', id }, body.fileId, body.category);
    await this.repo.addActivity(id, { type: 'attachment', summary: `File attached: ${a.fileName}`, actorUserId: p.userId, links: { fileId: a.fileId } });
    return { id: a.id, fileId: a.fileId, fileName: a.fileName, category: a.category, createdAt: a.createdAt.toISOString() };
  }

  // =================================================================== timeline and enquiries
  async timeline(p: Principal, id: string, query: TimelineQuery): Promise<ActivityPage> {
    await this.leads.visible(p, id, { includeDeleted: true });
    const types = query.types?.split(',').map((t) => t.trim()).filter(Boolean) as ActivityType[] | undefined;
    const unknown = types?.filter((t) => !(ACTIVITY_TYPES as readonly string[]).includes(t));
    if (unknown?.length) throw Problems.validation(unknown.map((t) => ({ field: 'types', message: `unknown type ${t}` })));
    const offset = query.cursor ? Number(decodeCursor(query.cursor, 1)[0]) : 0;
    const rows = await this.repo.timeline(id, query.limit + 1, offset, types);
    const hasMore = rows.length > query.limit;
    return {
      data: rows.slice(0, query.limit).map(ActivityDto.from),
      page: { nextCursor: hasMore ? encodeCursor([offset + query.limit]) : null, hasMore },
    };
  }

  async inquiries(p: Principal, id: string): Promise<InquiryDto[]> {
    await this.leads.visible(p, id, { includeDeleted: true });
    return (await this.repo.inquiries(id)).map(InquiryDto.from);
  }

  // =================================================================== bulk (max 500 per request)
  async bulk(p: Principal, body: BulkLeadActionDto): Promise<BulkResultDto> {
    const permission = { assign: 'leads.assign', stage: 'leads.edit', delete: 'leads.delete', restore: 'leads.delete' }[body.action];
    if (!p.permissions.has(permission)) throw Problems.forbidden();
    if (body.action === 'assign' && !body.toUserId) throw Problems.validation([{ field: 'toUserId', message: 'required for assign' }]);
    if (body.action === 'stage' && !body.stageId) throw Problems.validation([{ field: 'stageId', message: 'required for stage' }]);

    const result: BulkResultDto = { succeeded: [], failed: [] };
    for (const leadId of body.leadIds) {
      const outcome = await this.db.savepoint(async () => {
        switch (body.action) {
          case 'assign': {
            const { lead } = await this.leads.managed(p, leadId);
            await this.validateAssign(lead, body.toUserId!, body.reasonId);
            await this.leads.changeOwner(leadId, body.toUserId!, { method: 'manual', actorUserId: p.userId, reasonId: body.reasonId ?? null });
            break;
          }
          case 'stage':
            await this.changeStage(p, leadId, { stageId: body.stageId!, reasonId: body.reasonId });
            break;
          case 'delete':
            await this.leads.remove(p, leadId);
            break;
          case 'restore':
            await this.leads.restore(p, leadId);
            break;
        }
      });
      if (outcome.ok) result.succeeded.push(leadId);
      else {
        const err = outcome.error;
        if (!(err instanceof ProblemException)) throw err;
        result.failed.push({ id: leadId, code: err.code, message: err.detail ?? err.title });
      }
    }
    return result;
  }

  private async accessOfCurrentUser(leadId: string) {
    const principal = RequestContext.get().principal;
    const lead = principal && (await this.repo.find(leadId));
    if (!principal || !lead) return undefined;
    return (await this.scope.accessFor(principal, [lead])).get(leadId);
  }
}

