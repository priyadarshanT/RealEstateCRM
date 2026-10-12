import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DbService } from '../database/db.service';
import { RequestContext } from '../http/request-context';

/** Job payloads that belong to one tenant carry its ID; the handler then runs inside that tenant's transaction. */
export interface TenantJob {
  tenantId: string;
}

export type JobHandler<T> = (data: T) => Promise<void>;

interface Registration {
  handler: JobHandler<unknown>;
  cron?: string;
}

/**
 * Job queue wrapper (architecture §3 "queue: pg-boss wrapper, swap to Redis/SQS later").
 * - send(): from the API or the worker. Inside a tenant transaction the job is written in that transaction,
 *   so it only exists if the change commits.
 * - register(): modules declare handlers (and optional cron schedules) at start-up.
 * - startWorker(): the worker process (APP_MODE=worker) starts consuming. Jobs are claimed with row locks,
 *   so two workers never run the same job. Failed jobs retry 5 times with backoff (migration 0003).
 */
@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private readonly registrations = new Map<string, Registration>();
  private boss?: PgBoss;
  private starting?: Promise<PgBoss>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
  ) {}

  register<T>(name: string, handler: JobHandler<T>, options: { cron?: string } = {}): void {
    this.registrations.set(name, { handler: handler as JobHandler<unknown>, cron: options.cron });
  }

  async send<T extends object>(name: string, data: T, options: PgBoss.SendOptions = {}): Promise<string | null> {
    const boss = await this.instance();
    const client = this.db.currentClient;
    const db = client ? { executeSql: (text: string, values: unknown[]) => client.query(text, values) } : undefined;
    return boss.send(name, data, { ...options, ...(db ? { db } : {}) });
  }

  /** Worker mode: consume every registered queue and install the cron schedules. */
  async startWorker(): Promise<void> {
    const boss = await this.instance();
    for (const [name, reg] of this.registrations) {
      await boss.work(name, { batchSize: 1 }, async ([job]) => {
        if (job) await this.run(name, job.data);
      });
      if (reg.cron) await boss.schedule(name, reg.cron, {}, { tz: 'Asia/Dubai' });
    }
    this.logger.log(`worker consuming ${this.registrations.size} queue(s)`);
  }

  /** Runs every job waiting in a queue, in this process (tests and one-off scripts). Returns the count. */
  async drain(name: string): Promise<number> {
    const boss = await this.instance();
    let count = 0;
    for (;;) {
      const jobs = await boss.fetch(name, { batchSize: 10 });
      if (!jobs?.length) return count;
      for (const job of jobs) {
        try {
          await this.run(name, job.data);
          await boss.complete(name, job.id);
        } catch (err) {
          await boss.fail(name, job.id, { message: (err as Error).message });
          throw err;
        }
        count++;
      }
    }
  }

  /** Runs a registered handler directly (scheduled jobs in tests). */
  async runNow(name: string, data: object = {}): Promise<void> {
    await this.run(name, data);
  }

  private async run(name: string, data: unknown): Promise<void> {
    const reg = this.registrations.get(name);
    if (!reg) throw new Error(`No handler registered for queue ${name}`);
    const tenantId = (data as Partial<TenantJob> | null)?.tenantId;
    const work = () => reg.handler(data);
    // System actor: no signed-in user. Tenant jobs run inside that tenant's transaction (row-level security).
    await RequestContext.run({ tenantId, requestId: `job_${name}` }, () => (tenantId ? this.db.withTenant(tenantId, work) : work()));
  }

  private instance(): Promise<PgBoss> {
    if (this.boss) return Promise.resolve(this.boss);
    this.starting ??= (async () => {
      const worker = this.config.APP_MODE === 'worker';
      const boss = new PgBoss({
        connectionString: worker && this.config.WORKER_DATABASE_URL ? this.config.WORKER_DATABASE_URL : this.config.DATABASE_URL,
        schema: 'pgboss',
        migrate: false,
        supervise: worker,
        schedule: worker,
        max: 3,
        application_name: worker ? 'crm-worker-queue' : 'crm-api-queue',
      });
      boss.on('error', (err) => this.logger.error(`queue error: ${err.message}`));
      await boss.start();
      this.boss = boss;
      return boss;
    })();
    return this.starting;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss?.stop({ graceful: true, wait: true });
  }
}
