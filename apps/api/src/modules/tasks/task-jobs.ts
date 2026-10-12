import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { DbService } from '../../core/database/db.service';
import { WorkerDbService } from '../../core/database/worker-db.service';
import { EventBus } from '../../core/events/domain-events';
import { QueueService } from '../../core/queue/queue.service';
import { LeadsService } from '../leads/leads.service';
import { NotificationsService } from '../notifications/notifications.service';
import { tasks } from './tasks.schema';

const BATCH = 200;

/**
 * Background jobs of the tasks module (architecture §5), every minute:
 * - response-timer: leads whose owner did not act within the response time → lead.no_response (10-minute rule);
 * - reminders: task reminders before the due time and an alert once a task is overdue.
 * The scan runs across tenants (crm_worker); each item is then handled inside its own tenant transaction.
 */
@Injectable()
export class TaskJobs implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly workerDb: WorkerDbService,
    private readonly db: DbService,
    private readonly events: EventBus,
    private readonly notifications: NotificationsService,
    private readonly leads: LeadsService,
  ) {}

  onModuleInit(): void {
    this.queue.register('response-timer', async () => void (await this.responseTimer()), { cron: '* * * * *' });
    this.queue.register('reminders', async () => void (await this.reminders()), { cron: '* * * * *' });
  }

  async responseTimer(): Promise<number> {
    const due = await this.leads.responseOverdue(BATCH);
    for (const lead of due) {
      await this.db.withTenant(lead.tenantId, () => this.events.publish('lead.no_response', { tenantId: lead.tenantId, leadId: lead.id, userId: lead.ownerUserId }));
    }
    return due.length;
  }

  async reminders(): Promise<number> {
    const now = new Date();
    const remind = await this.workerDb.db
      .select({ id: tasks.id, tenantId: tasks.tenantId, userId: tasks.assignedUserId, title: tasks.title, leadId: tasks.leadId, dueAt: tasks.dueAt })
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'open'),
          isNull(tasks.remindedAt),
          isNotNull(tasks.reminderMinutes),
          sql`${tasks.dueAt} - make_interval(mins => ${tasks.reminderMinutes}::int) <= now()`,
          sql`${tasks.dueAt} > now()`,
        ),
      )
      .limit(BATCH);
    for (const t of remind) {
      await this.db.withTenant(t.tenantId, async () => {
        await this.notifications.notify({ userId: t.userId, type: 'task_due', title: `Reminder: ${t.title}`, body: `Due at ${t.dueAt.toISOString()}`, leadId: t.leadId });
        await this.db.current.update(tasks).set({ remindedAt: now }).where(eq(tasks.id, t.id));
      });
    }
    const overdue = await this.workerDb.db
      .select({ id: tasks.id, tenantId: tasks.tenantId, userId: tasks.assignedUserId, title: tasks.title, leadId: tasks.leadId })
      .from(tasks)
      .where(and(eq(tasks.status, 'open'), isNull(tasks.overdueAlertedAt), lt(tasks.dueAt, now)))
      .limit(BATCH);
    for (const t of overdue) {
      await this.db.withTenant(t.tenantId, async () => {
        await this.notifications.notify({ userId: t.userId, type: 'task_overdue', title: `Overdue: ${t.title}`, leadId: t.leadId });
        await this.db.current.update(tasks).set({ overdueAlertedAt: now }).where(eq(tasks.id, t.id));
      });
    }
    return remind.length + overdue.length;
  }
}
