import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional } from 'class-validator';
import { and, desc, eq } from 'drizzle-orm';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { WorkerDbService } from '../../core/database/worker-db.service';
import { Problems } from '../../core/errors/problem';
import { IsUuid } from '../../core/http/validators';
import { decodeCursor, encodeCursor, Page, PageInfo, PageQuery } from '../../core/http/pagination';
import { QueueService, TenantJob } from '../../core/queue/queue.service';
import { LeadsService } from '../leads/leads.service';
import { WebhookInbox } from './inbox/webhook-inbox';
import { integrations, reconciliationRuns, ReconciliationRow } from './integrations.schema';
import { IntegrationsService } from './integrations.service';
import { META_API, MetaApi } from './meta/meta-api';

// ---------------------------------------------------------------- DTOs (components.schemas.Reconciliation)
export class ReconciliationDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) integrationId!: string;
  @ApiProperty({ format: 'date-time' }) periodStart!: string;
  @ApiProperty({ format: 'date-time' }) periodEnd!: string;
  @ApiPropertyOptional() sourceCount!: number;
  @ApiPropertyOptional() crmCount!: number;
  @ApiPropertyOptional({ type: [String] }) missingExternalIds!: string[];
  @ApiPropertyOptional() recoveredCount!: number;
  @ApiProperty({ enum: ['running', 'completed', 'failed'] }) status!: ReconciliationRow['status'];

  static from(r: ReconciliationRow): ReconciliationDto {
    return {
      id: r.id,
      integrationId: r.integrationId,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      sourceCount: r.sourceCount,
      crmCount: r.crmCount,
      missingExternalIds: r.missingExternalIds,
      recoveredCount: r.recoveredCount,
      status: r.status,
    };
  }
}

export class ReconciliationPage {
  @ApiProperty({ type: [ReconciliationDto] }) data!: ReconciliationDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class ReconciliationRunDto {
  @ApiProperty({ format: 'date-time' }) @IsDateString() periodStart!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() periodEnd!: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() recoverMissing?: boolean;
}

export class ReconciliationListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() integrationId?: string;
}

interface ReconcileJob extends TenantJob {
  runId: string;
  recoverMissing: boolean;
}

const MAX_PERIOD_DAYS = 90; // Meta keeps lead-ad leads for 90 days
const DAY = 86_400_000;

/**
 * Meta check (SRS §8.7): compares the leads Meta has for a period with the leads in the CRM and recovers missing
 * ones through the normal lead intake. Admins run it on demand; a nightly job checks the previous day.
 */
@Injectable()
export class ReconciliationService implements OnModuleInit {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly db: DbService,
    private readonly workerDb: WorkerDbService,
    private readonly queue: QueueService,
    private readonly integrations: IntegrationsService,
    private readonly leads: LeadsService,
    private readonly inbox: WebhookInbox,
    @Inject(META_API) private readonly meta: MetaApi,
  ) {}

  onModuleInit(): void {
    this.queue.register<Partial<ReconcileJob>>('meta-reconciliation', (job) => (job.runId ? this.process(job.runId, job.recoverMissing ?? true) : this.nightly()), { cron: '30 2 * * *' });
  }

  async start(p: Principal, integrationId: string, body: ReconciliationRunDto): Promise<ReconciliationDto> {
    const integration = await this.integrations.get(integrationId);
    const start = new Date(body.periodStart);
    const end = new Date(body.periodEnd);
    const errors = [
      ...(integration.provider === 'meta' ? [] : [{ field: 'id', message: 'the Meta check runs on a Meta lead ads connection' }]),
      ...(integration.status === 'connected' ? [] : [{ field: 'id', message: 'connect Meta first' }]),
      ...(end > start ? [] : [{ field: 'periodEnd', message: 'must be after periodStart' }]),
      ...(end.getTime() - start.getTime() <= MAX_PERIOD_DAYS * DAY ? [] : [{ field: 'periodEnd', message: `the period can be ${MAX_PERIOD_DAYS} days at most` }]),
    ];
    if (errors.length) throw Problems.validation(errors);
    const run = await this.createRun(integrationId, start, end, p.userId);
    await this.queue.send<ReconcileJob>('meta-reconciliation', { tenantId: p.tenantId, runId: run.id, recoverMissing: body.recoverMissing ?? true });
    return ReconciliationDto.from(run);
  }

  async list(q: ReconciliationListQuery): Promise<Page<ReconciliationDto>> {
    const offset = q.cursor ? Number(decodeCursor(q.cursor, 1)[0]) : 0;
    const rows = await this.db.current
      .select()
      .from(reconciliationRuns)
      .where(q.integrationId ? eq(reconciliationRuns.integrationId, q.integrationId) : undefined)
      .orderBy(desc(reconciliationRuns.startedAt), desc(reconciliationRuns.id))
      .limit(q.limit + 1)
      .offset(offset);
    const hasMore = rows.length > q.limit;
    return { data: rows.slice(0, q.limit).map(ReconciliationDto.from), page: { nextCursor: hasMore ? encodeCursor([offset + q.limit]) : null, hasMore } };
  }

  /** meta-reconciliation job: the run's counts, the missing IDs, and missing leads sent back to the intake. */
  async process(runId: string, recoverMissing: boolean): Promise<void> {
    const [run] = await this.db.current.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, runId)).limit(1);
    if (!run || run.status !== 'running') return;
    const outcome = await this.db.savepoint(async () => {
      const integration = await this.integrations.get(run.integrationId);
      const token = await this.integrations.pageToken(integration);
      if (!token || !integration.externalAccountId) throw new Error('The access token is missing; connect Meta again');
      const ids = [...new Set(await this.meta.listLeadIds(integration.externalAccountId, token, run.periodStart, run.periodEnd))];
      const known = new Set(await this.leads.knownSubmissions(integration.id, ids));
      const missing = ids.filter((id) => !known.has(id));
      let recovered = 0;
      if (recoverMissing) {
        for (const id of missing) {
          const queued =
            (await this.inbox.store({ provider: 'meta', externalEventId: id, payload: { leadgen_id: id, page_id: integration.externalAccountId, recovered: true }, integration, queue: 'lead-intake' })) ||
            (await this.inbox.requeue('meta', id, integration, 'lead-intake'));
          if (queued) recovered++;
        }
      }
      return { sourceCount: ids.length, crmCount: known.size, missingExternalIds: missing, recoveredCount: recovered };
    });
    await this.db.current
      .update(reconciliationRuns)
      .set(outcome.ok ? { ...outcome.value, status: 'completed', finishedAt: new Date() } : { status: 'failed', errorDetail: (outcome.error as Error).message.slice(0, 1000), finishedAt: new Date() })
      .where(eq(reconciliationRuns.id, runId));
  }

  /** Nightly (02:30 Dubai): every connected Meta account, the previous 24 hours. */
  async nightly(): Promise<void> {
    const accounts = await this.workerDb.db
      .select({ id: integrations.id, tenantId: integrations.tenantId })
      .from(integrations)
      .where(and(eq(integrations.provider, 'meta'), eq(integrations.status, 'connected')));
    const end = new Date();
    const start = new Date(end.getTime() - DAY);
    for (const a of accounts) {
      try {
        await this.db.withTenant(a.tenantId, async () => {
          const run = await this.createRun(a.id, start, end, null);
          await this.process(run.id, true);
        });
      } catch (err) {
        this.logger.error(`Meta check for integration ${a.id} failed: ${(err as Error).message}`);
      }
    }
  }

  private async createRun(integrationId: string, start: Date, end: Date, userId: string | null): Promise<ReconciliationRow> {
    const [run] = await this.db.current
      .insert(reconciliationRuns)
      .values({ tenantId: this.db.currentTenantId!, integrationId, periodStart: start, periodEnd: end, sourceCount: 0, crmCount: 0, status: 'running', runBy: userId })
      .returning();
    return run!;
  }
}
