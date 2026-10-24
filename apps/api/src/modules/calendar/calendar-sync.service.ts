import { Controller, Headers, HttpCode, Inject, Injectable, Logger, OnModuleInit, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../../core/auth/decorators';
import { DbService } from '../../core/database/db.service';
import { Problems } from '../../core/errors/problem';
import { QueueService } from '../../core/queue/queue.service';
import { InboxJob, WebhookAck, WebhookInbox } from '../integrations/inbox/webhook-inbox';
import { IntegrationRow } from '../integrations/integrations.schema';
import { IntegrationsService } from '../integrations/integrations.service';
import { CALENDAR_SYNC, CalendarSyncProvider } from './adapters/calendar-sync';
import { MeetingsService } from './meetings.service';

const CALENDAR_NAME = { google_workspace: 'Google Calendar', microsoft_365: 'Microsoft 365' } as const;

/**
 * calendar-sync job (SRS §3.13): after a push notification from the agent's calendar, reads the changes since the
 * last sync and applies them to the CRM meetings; the provider's cursor is kept on the connection.
 * calendar-check (every 10 minutes) does the same for every connected calendar, so changes arrive even without
 * push notifications.
 */
@Injectable()
export class CalendarSyncService implements OnModuleInit {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(
    private readonly db: DbService,
    private readonly queue: QueueService,
    private readonly inbox: WebhookInbox,
    private readonly integrations: IntegrationsService,
    private readonly meetings: MeetingsService,
    @Inject(CALENDAR_SYNC) private readonly calendars: CalendarSyncProvider,
  ) {}

  onModuleInit(): void {
    this.queue.register<InboxJob>('calendar-sync', (job) => this.process(job.webhookEventId));
    this.queue.register('calendar-check', () => this.checkAll(), { cron: '*/10 * * * *' });
  }

  /** Syncs every connected calendar; one failing account (e.g. access revoked) does not stop the others. */
  async checkAll(): Promise<void> {
    for (const integration of await this.inbox.connectedAccounts(['google_workspace', 'microsoft_365'])) {
      try {
        await this.db.withTenant(integration.tenantId, () => this.sync(integration));
      } catch (err) {
        this.logger.warn(`Calendar check for connection ${integration.id} failed: ${(err as Error).message}`);
      }
    }
  }

  process(eventId: string): Promise<void> {
    return this.inbox.process('calendar-sync', eventId, (_event, integration) => this.sync(integration));
  }

  async sync(integration: IntegrationRow): Promise<void> {
    if (integration.provider !== 'google_workspace' && integration.provider !== 'microsoft_365') return;
    const cursor = typeof integration.settings.syncCursor === 'string' ? integration.settings.syncCursor : undefined;
    const result = await this.calendars.changes({ provider: integration.provider, settings: integration.settings, credentials: await this.integrations.calendarCredentials(integration) }, cursor);
    for (const change of result.changes) await this.meetings.applyExternalChange(change, CALENDAR_NAME[integration.provider]);
    if (result.cursor && result.cursor !== cursor) await this.integrations.saveSettings(integration.id, { syncCursor: result.cursor });
  }
}

/**
 * Push notifications from the agents' calendars. Google: X-Goog-Channel-ID / X-Goog-Channel-Token; Microsoft
 * Graph: subscriptionId / clientState (and the validationToken handshake). The channel token set when the watch
 * was created is checked; then a calendar-sync job reads the changes.
 */
@ApiTags('Webhooks (inbound)')
@Controller('webhooks/calendar')
@Public()
export class CalendarWebhookController {
  constructor(private readonly inbox: WebhookInbox) {}

  @Post(':provider')
  @HttpCode(200)
  @ApiOperation({ operationId: 'receiveCalendarChange', summary: 'Receive calendar change' })
  @ApiOkResponse({ type: WebhookAck })
  async receive(
    @Param('provider') provider: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('validationToken') validationToken?: string,
    @Headers('x-goog-channel-id') channelId?: string,
    @Headers('x-goog-channel-token') channelToken?: string,
    @Headers('x-goog-resource-state') resourceState?: string,
    @Headers('x-goog-message-number') messageNumber?: string,
  ): Promise<WebhookAck | string> {
    if (provider === 'google') {
      const integration = channelId ? await this.inbox.accountBySetting(['google_workspace'], 'watchChannelId', channelId) : undefined;
      if (!integration) throw Problems.notFound('Unknown calendar channel.');
      if (!sameSecret(channelToken, integration.settings.watchToken)) throw Problems.unauthorized('Invalid channel token.');
      // "sync" only announces a new channel; there is nothing to read yet.
      if (resourceState !== 'sync') await this.queueSync('google_workspace', integration, `${channelId}:${messageNumber ?? Date.now()}`);
      return { received: true };
    }
    if (provider === 'microsoft') {
      if (validationToken) {
        // Subscription handshake: Graph expects the token back as plain text.
        res.type('text/plain');
        return validationToken;
      }
      const notifications = ((req.body as { value?: { subscriptionId?: string; clientState?: string; changeType?: string; resource?: string }[] })?.value ?? []).slice(0, 100);
      for (const [i, n] of notifications.entries()) {
        const integration = n.subscriptionId ? await this.inbox.accountBySetting(['microsoft_365'], 'subscriptionId', n.subscriptionId) : undefined;
        if (!integration) throw Problems.notFound('Unknown calendar subscription.');
        if (!sameSecret(n.clientState, integration.settings.watchToken)) throw Problems.unauthorized('Invalid clientState.');
        await this.queueSync('microsoft_365', integration, `${n.subscriptionId}:${n.changeType}:${n.resource}:${Date.now()}:${i}`);
      }
      return { received: true };
    }
    throw Problems.notFound('Unknown calendar provider.');
  }

  private queueSync(provider: string, integration: IntegrationRow, externalEventId: string): Promise<boolean> {
    return this.inbox.store({ provider, externalEventId, payload: { calendarChange: true }, integration, queue: 'calendar-sync' });
  }
}

function sameSecret(given: string | undefined, expected: unknown): boolean {
  if (!given || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
