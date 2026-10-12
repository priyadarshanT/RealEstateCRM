import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt, min, sql, SQL } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { ProblemException, Problems } from '../../core/errors/problem';
import { decodeCursor, encodeCursor } from '../../core/http/pagination';
import { ActivityDto } from '../leads/dto/lead.dto';
import { LeadsService } from '../leads/leads.service';
import { OrganizationDirectory } from '../organization/directory.service';
import { CallLogDto, NextActionDto, TaskCompleteDto, TaskCompleteResult, TaskDto, TaskInputDto, TaskListQuery, TaskPage } from './dto/task.dto';
import { CallOutcome, TaskRow, tasks } from './tasks.schema';

const OUTCOME_LABEL: Record<CallOutcome, string> = {
  answered: 'Answered',
  no_answer: 'No answer',
  busy: 'Busy',
  wrong_number: 'Wrong number',
  call_back: 'Call back',
};
const TYPE_LABEL = { call: 'Call', follow_up: 'Follow-up', meeting: 'Meeting', viewing: 'Viewing', personal: 'Task' } as const;

/**
 * Tasks, calls, calendar views and next actions (SRS §3.1–3.3). Completing a lead task or logging a call counts
 * as the owner's response for the 10-minute rule and moves the lead's next follow-up to the earliest open task.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly db: DbService,
    private readonly leads: LeadsService,
    private readonly directory: OrganizationDirectory,
    private readonly audit: AuditService,
  ) {}

  // =================================================================== list
  /** Own tasks; managers also see the tasks of people in their scope. */
  async list(p: Principal, q: TaskListQuery): Promise<TaskPage> {
    const where: (SQL | undefined)[] = [await this.scope(p)];
    if (q.assignedUserId) where.push(eq(tasks.assignedUserId, q.assignedUserId));
    if (q.leadId) {
      await this.leads.visible(p, q.leadId, { includeDeleted: true });
      where.push(eq(tasks.leadId, q.leadId));
    }
    if (q.status) where.push(eq(tasks.status, q.status));
    if (q.type) where.push(eq(tasks.type, q.type));
    const [from, to] = range(q);
    if (from) where.push(gte(tasks.dueAt, from));
    if (to) where.push(lt(tasks.dueAt, to));
    if (q.overdue) where.push(eq(tasks.status, 'open'), lt(tasks.dueAt, new Date()));

    const offset = q.cursor ? Number(decodeCursor(q.cursor, 1)[0]) : 0;
    const rows = await this.db.current
      .select()
      .from(tasks)
      .where(and(...where))
      .orderBy(asc(tasks.dueAt), asc(tasks.id))
      .limit(q.limit + 1)
      .offset(offset);
    const hasMore = rows.length > q.limit;
    return { data: rows.slice(0, q.limit).map(TaskDto.from), page: { nextCursor: hasMore ? encodeCursor([offset + q.limit]) : null, hasMore } };
  }

  // =================================================================== create / update / cancel
  async create(p: Principal, body: TaskInputDto): Promise<TaskRow> {
    const missing = (['type', 'title', 'dueAt'] as const).filter((f) => !body[f]);
    if (missing.length) throw Problems.validation(missing.map((field) => ({ field, message: `${field} is required` })));
    if (body.type !== 'personal' && !body.leadId) throw Problems.validation([{ field: 'leadId', message: 'required for lead tasks' }]);
    if (body.leadId) await this.leads.editable(p, body.leadId);
    const assignee = body.assignedUserId ?? p.userId;
    await this.assertAssignee(p, assignee);
    const [task] = await this.db.current
      .insert(tasks)
      .values({
        tenantId: p.tenantId,
        leadId: body.leadId ?? null,
        assignedUserId: assignee,
        type: body.type!,
        title: body.title!,
        description: body.description ?? null,
        dueAt: new Date(body.dueAt!),
        durationMinutes: body.durationMinutes ?? null,
        reminderMinutes: body.reminderMinutes ?? null,
        meetingId: body.meetingId ?? null,
        createdBy: p.userId,
      })
      .returning();
    if (task!.leadId) await this.refreshFollowUp(task!.leadId);
    await this.audit.record('create', 'tasks', task!.id, { type: [null, task!.type], dueAt: [null, task!.dueAt.toISOString()] });
    return task!;
  }

  async update(p: Principal, id: string, body: TaskInputDto): Promise<TaskRow> {
    const before = await this.editable(p, id);
    if (before.status !== 'open') throw new ProblemException(422, 'INVALID_STATE', 'Task is closed', 'Only open tasks can be changed.');
    if (body.assignedUserId && body.assignedUserId !== before.assignedUserId) await this.assertAssignee(p, body.assignedUserId);
    const patch: Partial<TaskRow> = {};
    if (body.assignedUserId !== undefined) patch.assignedUserId = body.assignedUserId;
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.dueAt !== undefined) {
      patch.dueAt = new Date(body.dueAt);
      patch.remindedAt = null;
      patch.overdueAlertedAt = null;
    }
    if (body.durationMinutes !== undefined) patch.durationMinutes = body.durationMinutes;
    if (body.reminderMinutes !== undefined) patch.reminderMinutes = body.reminderMinutes;
    if (!Object.keys(patch).length) return before;
    const [after] = await this.db.current.update(tasks).set({ ...patch, updatedAt: new Date() }).where(eq(tasks.id, id)).returning();
    if (after!.leadId) await this.refreshFollowUp(after!.leadId);
    await this.audit.recordUpdate('tasks', id, auditView(before), auditView(after!));
    return after!;
  }

  async cancel(p: Principal, id: string): Promise<TaskRow> {
    const before = await this.editable(p, id);
    if (before.status !== 'open') throw new ProblemException(422, 'INVALID_STATE', 'Task is closed', 'Only open tasks can be cancelled.');
    const [after] = await this.db.current.update(tasks).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(tasks.id, id)).returning();
    if (after!.leadId) await this.refreshFollowUp(after!.leadId);
    await this.audit.record('cancel', 'tasks', id, { status: ['open', 'cancelled'] });
    return after!;
  }

  // =================================================================== complete and log a call
  async complete(p: Principal, id: string, body: TaskCompleteDto): Promise<TaskCompleteResult> {
    const task = await this.editable(p, id);
    if (task.status !== 'open') throw new ProblemException(422, 'INVALID_STATE', 'Task is closed', 'This task is already closed.');
    if (task.type === 'call' && !body.outcome) {
      throw new ProblemException(422, 'OUTCOME_REQUIRED', 'Outcome required', 'Choose the call outcome: answered, no answer, busy, wrong number or call back.');
    }
    const lead = task.leadId ? await this.leads.findRow(task.leadId) : undefined;
    if (lead && lead.stageCategory === 'open' && !lead.deletedAt && !body.nextAction) {
      throw new ProblemException(422, 'NEXT_ACTION_REQUIRED', 'Next action required', 'Plan the next action for this lead.');
    }

    const now = new Date();
    const nextTask = lead && body.nextAction ? await this.createNext(p, lead.id, task.assignedUserId, body.nextAction) : null;
    const [done] = await this.db.current
      .update(tasks)
      .set({
        status: 'completed',
        outcome: task.type === 'call' ? body.outcome! : null,
        outcomeNote: body.outcomeNote ?? null,
        completedAt: now,
        completedBy: p.userId,
        nextTaskId: nextTask?.id ?? null,
        updatedAt: now,
      })
      .where(eq(tasks.id, id))
      .returning();
    if (lead) {
      const summary = task.type === 'call' ? `Call: ${OUTCOME_LABEL[body.outcome!]}` : `${TYPE_LABEL[task.type]} done: ${task.title}`;
      await this.leads.addActivity(lead.id, { type: task.type === 'call' ? 'call' : 'system', summary, body: body.outcomeNote ?? null, actorUserId: p.userId, links: { taskId: id } });
      await this.refreshFollowUp(lead.id);
      await this.leads.recordAction(lead.id, p.userId);
    }
    await this.audit.record('update', 'tasks', id, { status: ['open', 'completed'], ...(body.outcome ? { outcome: [null, body.outcome] } : {}) });
    return { task: TaskDto.from(done!), nextTask: nextTask ? TaskDto.from(nextTask) : null };
  }

  /** POST /leads/{id}/calls: a call that was not planned as a task (SRS §3.2). */
  async logCall(p: Principal, leadId: string, body: CallLogDto): Promise<ActivityDto> {
    const { lead } = await this.leads.editable(p, leadId);
    const now = new Date();
    const nextTask = body.nextAction ? await this.createNext(p, leadId, p.userId, body.nextAction) : null;
    const [call] = await this.db.current
      .insert(tasks)
      .values({
        tenantId: p.tenantId,
        leadId,
        assignedUserId: p.userId,
        type: 'call',
        title: 'Call',
        description: body.durationSeconds ? `Duration ${Math.round(body.durationSeconds / 60)} min` : null,
        dueAt: now,
        durationMinutes: body.durationSeconds ? Math.max(1, Math.round(body.durationSeconds / 60)) : null,
        status: 'completed',
        outcome: body.outcome,
        outcomeNote: body.note ?? null,
        completedAt: now,
        completedBy: p.userId,
        nextTaskId: nextTask?.id ?? null,
        createdBy: p.userId,
      })
      .returning();
    const activity = await this.leads.addActivity(leadId, {
      type: 'call',
      summary: `Call: ${OUTCOME_LABEL[body.outcome]}${body.outcome === 'wrong_number' ? ' (consider moving the lead to Invalid)' : ''}`,
      body: body.note ?? null,
      actorUserId: p.userId,
      links: { taskId: call!.id },
    });
    if (nextTask || lead.stageCategory === 'open') await this.refreshFollowUp(leadId);
    await this.leads.recordAction(leadId, p.userId);
    return ActivityDto.from(activity);
  }

  // =================================================================== helpers
  /** The lead's next follow-up is its earliest open task (SRS §2.20; Scheduled and Overdue tabs). */
  async refreshFollowUp(leadId: string): Promise<void> {
    const [row] = await this.db.current
      .select({ next: min(tasks.dueAt) })
      .from(tasks)
      .where(and(eq(tasks.leadId, leadId), eq(tasks.status, 'open')));
    await this.leads.setNextFollowUp(leadId, row?.next ?? null);
  }

  private async createNext(p: Principal, leadId: string, assignee: string, next: NextActionDto): Promise<TaskRow> {
    const [task] = await this.db.current
      .insert(tasks)
      .values({
        tenantId: p.tenantId,
        leadId,
        assignedUserId: assignee,
        type: next.type,
        title: next.title ?? TYPE_LABEL[next.type],
        dueAt: new Date(next.dueAt),
        reminderMinutes: next.reminderMinutes ?? null,
        createdBy: p.userId,
      })
      .returning();
    return task!;
  }

  /** Assignee or creator, a manager whose scope covers the assignee, or edit access to the lead. */
  private async editable(p: Principal, id: string): Promise<TaskRow> {
    const [task] = await this.db.current.select().from(tasks).where(and(eq(tasks.id, id), await this.scope(p))).limit(1);
    if (task) return task;
    const [leadTask] = await this.db.current.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (leadTask?.leadId) {
      await this.leads.editable(p, leadTask.leadId);
      return leadTask;
    }
    throw Problems.notFound();
  }

  private async scope(p: Principal): Promise<SQL | undefined> {
    if (p.dataScope === 'company') return undefined;
    const mine = sql`(${tasks.assignedUserId} = ${p.userId} OR ${tasks.createdBy} = ${p.userId})`;
    if (p.dataScope === 'own') return mine;
    const teamIds = await this.directory.scopeTeamIds(p.userId, p.dataScope);
    if (!teamIds.length) return mine;
    const members = (await Promise.all(teamIds.map((t) => this.directory.teamMembers(t)))).flat().map((u) => u.id);
    return members.length ? sql`(${mine} OR ${inArray(tasks.assignedUserId, members)})` : mine;
  }

  private async assertAssignee(p: Principal, userId: string): Promise<void> {
    const user = await this.directory.user(userId);
    if (!user || user.status !== 'active') throw Problems.validation([{ field: 'assignedUserId', message: 'the user is not active' }]);
    if (userId !== p.userId && p.dataScope === 'own') throw Problems.forbidden('You can only plan tasks for yourself.');
  }
}

/** Calendar views: day, week or month starting at `from` (or today); `to` overrides the end. */
function range(q: TaskListQuery): [Date | undefined, Date | undefined] {
  const start = q.from ? new Date(`${q.from}T00:00:00Z`) : q.view && q.view !== 'list' ? startOfToday() : undefined;
  let end = q.to ? new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000) : undefined;
  if (!end && start && q.view && q.view !== 'list') {
    end = new Date(start);
    if (q.view === 'day') end.setUTCDate(end.getUTCDate() + 1);
    if (q.view === 'week') end.setUTCDate(end.getUTCDate() + 7);
    if (q.view === 'month') end.setUTCMonth(end.getUTCMonth() + 1);
  }
  return [start, end];
}

function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function auditView(t: TaskRow) {
  return { assignedUserId: t.assignedUserId, title: t.title, dueAt: t.dueAt.toISOString(), reminderMinutes: t.reminderMinutes };
}
