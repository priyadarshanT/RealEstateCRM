import { Controller, Get, HttpCode, Inject, Logger, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../../core/auth/decorators';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { Problems } from '../../../core/errors/problem';
import { WebhookAck, WebhookInbox } from '../inbox/webhook-inbox';
import { validMetaSignature } from './meta-api';

export { WebhookAck };

interface LeadgenChange {
  field: string;
  value: { leadgen_id?: string; page_id?: string; form_id?: string; ad_id?: string; adgroup_id?: string; created_time?: number };
}

/**
 * Meta lead ads webhook (architecture §4 steps 1–2): signature checked, each lead saved to webhook_events
 * (duplicate event IDs ignored), answered at once; the worker does the rest. Events are routed to the tenant
 * whose connected page sent them, so this step reads across tenants (crm_worker). The lead-intake job (IncomingLeadIntake) fetches the answers.
 */
@ApiTags('Webhooks (inbound)')
@Controller('webhooks/meta')
@Public()
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly inbox: WebhookInbox,
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
    const integration = await this.inbox.accountById(['meta'], pageId);
    const stored = await this.inbox.store({ provider: 'meta', externalEventId: leadgenId, payload, integration, queue: 'lead-intake', ignoredReason: `No connected integration for page ${pageId}` });
    if (stored && !integration) this.logger.warn(`Meta lead ${leadgenId} for unknown page ${pageId} ignored`);
  }
}
