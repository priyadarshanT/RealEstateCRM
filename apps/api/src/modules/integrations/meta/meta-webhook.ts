import { Controller, Get, HttpCode, Inject, Injectable, Logger, OnModuleInit, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { and, eq, sql } from 'drizzle-orm';
import { Request } from 'express';
import { Public } from '../../../core/auth/decorators';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { DbService } from '../../../core/database/db.service';
import { WorkerDbService } from '../../../core/database/worker-db.service';
import { Problems } from '../../../core/errors/problem';
import { QueueService, TenantJob } from '../../../core/queue/queue.service';
import { LeadIntakeService } from '../../leads/lead-intake.service';
import { MarketingService } from '../../marketing/marketing.service';
import { LeadConfigService } from '../../settings/lead-config.service';
import { IntegrationRow, integrations, webhookEvents } from '../integrations.schema';
import { IntegrationsService } from '../integrations.service';
import { META_API, MetaApi, MetaLead, validMetaSignature } from './meta-api';

export class WebhookAck {
  @ApiProperty() received!: boolean;
}

interface LeadgenChange {
  field: string;
  value: { leadgen_id?: string; page_id?: string; form_id?: string; ad_id?: string; adgroup_id?: string; created_time?: number };
}

/**
 * Meta lead ads webhook (architecture §4 steps 1–2): signature checked, each lead saved to webhook_events
 * (duplicate event IDs ignored), answered at once; the worker does the rest. Events are routed to the tenant
 * whose connected page sent them, so this step reads across tenants (crm_worker).
 */
@ApiTags('Webhooks (inbound)')
@Controller('webhooks/meta')
@Public()
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly workerDb: WorkerDbService,
    private readonly queue: QueueService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'verifyMetaWebhook', summary: 'Meta webhook verification' })
  @ApiOkResponse({ type: String })
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string): string {
    if (mode !== 'subscribe' || !this.config.META_VERIFY_TOKEN || token !== this.config.META_VERIFY_TOKEN) throw Problems.forbidden('Verification failed.');
    return challenge;
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: 'receiveMetaLead', summary: 'Meta lead ads webhook' })
  @ApiOkResponse({ type: WebhookAck })
  async receive(@Req() req: Request & { rawBody?: Buffer }): Promise<WebhookAck> {
    if (!validMetaSignature(req.rawBody, req.header('x-hub-signature-256'), this.config.META_APP_SECRET)) {
      throw Problems.unauthorized('Invalid X-Hub-Signature-256.');
    }
    const body = req.body as { object?: string; entry?: { id?: string; changes?: LeadgenChange[] }[] };
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'leadgen' || !change.value.leadgen_id) continue;
        await this.store(change.value.page_id ?? entry.id ?? '', change.value.leadgen_id, change.value as Record<string, unknown>);
      }
    }
    return { received: true };
  }

  private async store(pageId: string, leadgenId: string, payload: Record<string, unknown>): Promise<void> {
    const [integration] = await this.workerDb.db
      .select({ id: integrations.id, tenantId: integrations.tenantId })
      .from(integrations)
      .where(and(eq(integrations.provider, 'meta'), eq(integrations.externalAccountId, pageId), eq(integrations.status, 'connected')))
      .limit(1);
    const [event] = await this.workerDb.db
      .insert(webhookEvents)
      .values({
        tenantId: integration?.tenantId ?? null,
        integrationId: integration?.id ?? null,
        provider: 'meta',
        externalEventId: leadgenId,
        signatureValid: true,
        payload,
        status: integration ? 'received' : 'ignored',
        lastError: integration ? null : `No connected integration for page ${pageId}`,
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (!event) return; // the same lead ID was already received
    if (integration) await this.queue.send<IntakeJob>('lead-intake', { tenantId: integration.tenantId, webhookEventId: event.id });
    else this.logger.warn(`Meta lead ${leadgenId} for unknown page ${pageId} ignored`);
  }
}

export interface IntakeJob extends TenantJob {
  webhookEventId: string;
}

const MAX_ATTEMPTS = 5;

/**
 * lead-intake job (architecture §4 steps 3–8): fetch the full answers from Meta, then the shared lead intake
 * (re-enquiry, assignment, score, notification, timer). Failures retry 5 times with a growing delay, then stay
 * failed on the Integrations screen with Retry.
 */
@Injectable()
export class MetaLeadIntake implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly queue: QueueService,
    private readonly integrationsService: IntegrationsService,
    private readonly intake: LeadIntakeService,
    private readonly config: LeadConfigService,
    private readonly marketing: MarketingService,
    @Inject(META_API) private readonly meta: MetaApi,
  ) {}

  onModuleInit(): void {
    this.queue.register<IntakeJob>('lead-intake', (job) => this.process(job.webhookEventId));
  }

  async process(eventId: string): Promise<void> {
    const [event] = await this.db.current.select().from(webhookEvents).where(eq(webhookEvents.id, eventId)).limit(1);
    if (!event || event.status !== 'received' || !event.integrationId) return;
    const integration = await this.integrationsService.get(event.integrationId);
    const outcome = await this.db.savepoint(async () => {
      if (integration.status !== 'connected') throw new Error(`Integration is ${integration.status}`);
      const token = await this.integrationsService.pageToken(integration);
      if (!token) throw new Error('Access token missing; connect Meta again');
      const lead = await this.meta.fetchLead(event.externalEventId, token);
      return this.intake.receive(await this.toIntake(integration, lead));
    });

    if (outcome.ok) {
      await this.db.current.update(webhookEvents).set({ status: 'processed', attempts: sql`${webhookEvents.attempts} + 1`, processedAt: new Date(), lastError: null }).where(eq(webhookEvents.id, eventId));
      await this.db.current.update(integrations).set({ lastSuccessAt: new Date() }).where(eq(integrations.id, integration.id));
      return;
    }
    const message = (outcome.error as Error).message.slice(0, 1000);
    const attempts = event.attempts + 1;
    await this.db.current.update(webhookEvents).set({ status: attempts >= MAX_ATTEMPTS ? 'failed' : 'received', attempts, lastError: message }).where(eq(webhookEvents.id, eventId));
    await this.db.current.update(integrations).set({ lastError: message, lastErrorAt: new Date() }).where(eq(integrations.id, integration.id));
    if (attempts < MAX_ATTEMPTS) {
      await this.queue.send<IntakeJob>('lead-intake', { tenantId: event.tenantId!, webhookEventId: eventId }, { startAfter: 30 * 2 ** (attempts - 1) });
    }
  }

  private async toIntake(integration: IntegrationRow, lead: MetaLead) {
    const answers = Object.fromEntries(lead.fieldData.map((f) => [f.name, f.values.join(', ')]));
    const pick = (...names: string[]) => names.map((n) => answers[n]).find((v) => v);
    const sourceId = await this.sourceFor(integration);
    const campaignId = lead.campaignId ? await this.marketing.findOrCreateExternal(sourceId, lead.campaignId, lead.campaignName ?? `Meta campaign ${lead.campaignId}`) : null;
    const name = pick('full_name') ?? ([pick('first_name'), pick('last_name')].filter(Boolean).join(' ') || null);
    return {
      sourceId,
      fullName: name,
      phone: pick('phone_number', 'phone'),
      email: pick('email'),
      campaignId,
      integrationId: integration.id,
      externalCampaignId: lead.campaignId ?? null,
      externalAdsetId: lead.adsetId ?? null,
      externalAdId: lead.adId ?? null,
      externalFormId: lead.formId ?? null,
      externalSubmissionId: lead.id,
      formName: lead.formName ?? null,
      formAnswers: answers,
      rawPayload: lead,
      submittedAt: lead.createdTime,
    };
  }

  /** The source chosen in the integration's settings, else the tenant's Meta source (created on first use). */
  private async sourceFor(integration: IntegrationRow): Promise<string> {
    if (typeof integration.settings.sourceId === 'string') return integration.settings.sourceId;
    const existing = await this.config.sourceByType('meta');
    if (existing) return existing.id;
    return (await this.config.createSource({ type: 'meta', name: 'Meta lead ads', qualityScore: 60 })).id;
  }
}

