import { Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../core/auth/decorators';
import { APP_CONFIG, AppConfig } from '../../core/config/app-config';
import { Problems } from '../../core/errors/problem';
import { WebhookAck, WebhookInbox } from '../integrations/inbox/webhook-inbox';
import { validMetaSignature } from '../integrations/meta/meta-api';
import { WaInboundMessage, WaStatus, WhatsAppEvent } from './inbound.service';

interface WaChange {
  field: string;
  value: {
    metadata?: { phone_number_id?: string };
    contacts?: { wa_id?: string; profile?: { name?: string } }[];
    messages?: WaInboundMessage[];
    statuses?: WaStatus[];
    event?: string;
    message_template_id?: string | number;
    reason?: string;
  };
}

/**
 * WhatsApp Business Platform webhook (SRS §5.1, §5.4): replies, delivery / read receipts and template approvals.
 * Signature X-Hub-Signature-256 (app secret); each item is stored once and processed by the message-status job.
 * The number (phone_number_id) or business account (WABA ID) says which company it belongs to.
 */
@ApiTags('Webhooks (inbound)')
@Controller('webhooks/whatsapp')
@Public()
export class WhatsAppWebhookController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly inbox: WebhookInbox,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'verifyWhatsappWebhook', summary: 'Verify WhatsApp webhook' })
  @ApiOkResponse({ type: String })
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string): string {
    if (mode !== 'subscribe' || !this.config.META_VERIFY_TOKEN || token !== this.config.META_VERIFY_TOKEN) throw Problems.validation([{ field: 'hub.verify_token', message: 'verification failed' }]);
    return challenge;
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: 'receiveWhatsappMessageOrStatus', summary: 'Receive WhatsApp message or status' })
  @ApiOkResponse({ type: WebhookAck })
  async receive(@Req() req: Request & { rawBody?: Buffer }): Promise<WebhookAck> {
    if (!validMetaSignature(req.rawBody, req.header('x-hub-signature-256'), this.config.META_APP_SECRET)) throw Problems.unauthorized('Invalid X-Hub-Signature-256.');
    const body = req.body as { entry?: { id?: string; time?: number; changes?: WaChange[] }[] };
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field === 'messages') {
          const phoneNumberId = change.value.metadata?.phone_number_id ?? '';
          const integration = await this.inbox.accountById(['whatsapp_cloud'], phoneNumberId);
          for (const message of change.value.messages ?? []) {
            const contact = change.value.contacts?.find((c) => c.wa_id === message.from) ?? change.value.contacts?.[0];
            await this.store(`msg:${message.id}`, { kind: 'message', message, contactName: contact?.profile?.name ?? null }, integration, phoneNumberId);
          }
          for (const status of change.value.statuses ?? []) await this.store(`status:${status.id}:${status.status}`, { kind: 'status', status }, integration, phoneNumberId);
        } else if (change.field === 'message_template_status_update' && change.value.message_template_id) {
          const integration = await this.inbox.accountBySetting(['whatsapp_cloud'], 'wabaId', entry.id ?? '');
          const templateId = String(change.value.message_template_id);
          await this.store(`template:${templateId}:${change.value.event}:${entry.time ?? Date.now()}`, { kind: 'template', providerTemplateId: templateId, event: change.value.event ?? '', reason: change.value.reason ?? null }, integration, entry.id ?? '');
        }
      }
    }
    return { received: true };
  }

  private store(externalEventId: string, payload: WhatsAppEvent, integration: { id: string; tenantId: string } | undefined, account: string): Promise<boolean> {
    return this.inbox.store({
      provider: 'whatsapp_cloud',
      externalEventId,
      payload: payload as unknown as Record<string, unknown>,
      integration,
      queue: 'message-status',
      ignoredReason: `No connected WhatsApp account ${account}`,
    });
  }
}
