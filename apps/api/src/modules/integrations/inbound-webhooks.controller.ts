import { Controller, Headers, HttpCode, Inject, Logger, Param, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../core/auth/decorators';
import { Problems } from '../../core/errors/problem';
import { SNS_VERIFIER, SnsMessage, SnsVerifier } from './adapters/sns-verifier';
import { FieldMapping, mapFields } from './inbox/field-mapping';
import { EMAIL_EVENT_PROVIDER } from './inbox/incoming-lead-intake';
import { readLeadEmail } from './inbox/lead-email';
import { rawBodyOf, sha256, validHmac, WebhookAck, WebhookInbox } from './inbox/webhook-inbox';
import { IntegrationRow } from './integrations.schema';
import { IntegrationsService, PORTAL_PROVIDERS } from './integrations.service';

type Raw = Request & { rawBody?: Buffer };

/**
 * Leads pushed by other systems (SRS §11.1–11.2): the general webhook, property portals and portal lead emails.
 * Each request is checked, stored and answered at once; the lead-intake job maps it into a lead.
 */
@ApiTags('Webhooks (inbound)')
@Controller('webhooks')
@Public()
export class InboundWebhooksController {
  private readonly logger = new Logger(InboundWebhooksController.name);

  constructor(
    private readonly inbox: WebhookInbox,
    private readonly integrations: IntegrationsService,
    @Inject(SNS_VERIFIER) private readonly sns: SnsVerifier,
  ) {}

  /** Website, Google Sheets, Excel (Power Automate), Make.com: X-Signature = HMAC-SHA256 of the body with the secret. */
  @Post('inbound/:token')
  @HttpCode(200)
  @ApiOperation({ operationId: 'receiveGeneralWebhookLead', summary: 'Receive general webhook lead' })
  @ApiOkResponse({ type: WebhookAck })
  async general(@Param('token') token: string, @Req() req: Raw, @Headers('x-signature') signature?: string, @Headers('x-event-id') eventId?: string): Promise<WebhookAck> {
    const integration = await this.inbox.accountById(['webhook', 'website'], token);
    if (!integration) throw Problems.notFound('This webhook link does not exist or was removed.');
    const raw = await rawBodyOf(req);
    const { secret } = await this.integrations.credentials(integration);
    if (!validHmac(raw, signature, secret)) throw Problems.unauthorized('Invalid X-Signature.');
    await this.storeLead('webhook', integration, objectBody(req.body), raw, eventId);
    return { received: true };
  }

  /** Property Finder, Bayut, Dubizzle: "Authorization: Bearer <shared secret>" identifies the account. */
  @Post('portals/:provider')
  @HttpCode(200)
  @ApiOperation({ operationId: 'receivePortalLead', summary: 'Receive portal lead' })
  @ApiOkResponse({ type: WebhookAck })
  async portal(@Param('provider') provider: string, @Req() req: Raw, @Headers('authorization') authorization?: string): Promise<WebhookAck> {
    if (!(PORTAL_PROVIDERS as readonly string[]).includes(provider)) throw Problems.notFound('Unknown portal.');
    const secret = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]?.trim();
    const integration = secret ? await this.inbox.accountBySetting([provider as (typeof PORTAL_PROVIDERS)[number]], 'secretHash', sha256(secret)) : undefined;
    if (!integration) throw Problems.unauthorized('Unknown or missing shared secret.');
    await this.storeLead(provider, integration, objectBody(req.body), await rawBodyOf(req));
    return { received: true };
  }

  /** SES → SNS: lead emails from portals, routed by the address they were sent to. */
  @Post('email-inbound')
  @HttpCode(200)
  @ApiOperation({ operationId: 'receivePortalLeadEmail', summary: 'Receive portal lead email' })
  @ApiOkResponse({ type: WebhookAck })
  async email(@Req() req: Raw): Promise<WebhookAck> {
    let message: SnsMessage;
    try {
      message = JSON.parse((await rawBodyOf(req)).toString('utf8')) as SnsMessage;
    } catch {
      throw Problems.validation([{ field: 'body', message: 'not an SNS message' }]);
    }
    if (!message?.Type || !message.MessageId) throw Problems.validation([{ field: 'body', message: 'not an SNS message' }]);
    if (!(await this.sns.verify(message))) throw Problems.unauthorized('Invalid SNS signature.');
    if (message.Type === 'SubscriptionConfirmation') {
      await this.sns.confirmSubscription(message);
      return { received: true };
    }
    const email = message.Type === 'Notification' ? readLeadEmail(message.Message) : undefined;
    if (!email) return { received: true };
    let integration: IntegrationRow | undefined;
    for (const to of email.recipients) {
      integration = await this.inbox.accountBySetting([...PORTAL_PROVIDERS], 'inboundEmail', to);
      if (integration) break;
    }
    await this.inbox.store({
      provider: EMAIL_EVENT_PROVIDER,
      externalEventId: email.messageId,
      payload: { messageId: email.messageId, from: email.from, subject: email.subject, recipients: email.recipients, fields: email.fields, text: email.text },
      integration,
      queue: 'lead-intake',
      ignoredReason: `No connection uses ${email.recipients.join(', ') || 'this address'}`,
    });
    if (!integration) this.logger.warn(`Lead email ${email.messageId} for ${email.recipients.join(', ')} ignored`);
    return { received: true };
  }

  /** The same lead sent twice (same ID, or the same body) is stored once. */
  private async storeLead(provider: string, integration: IntegrationRow, payload: Record<string, unknown>, raw: Buffer, eventId?: string): Promise<void> {
    const id = eventId?.trim() || mapFields(payload, (integration.settings.fieldMapping as FieldMapping | undefined) ?? {}).externalId || sha256(raw);
    await this.inbox.store({ provider, externalEventId: `${integration.id}:${id}`, payload, integration, queue: 'lead-intake' });
  }
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Problems.validation([{ field: 'body', message: 'send one lead as a JSON object' }]);
  return body as Record<string, unknown>;
}
