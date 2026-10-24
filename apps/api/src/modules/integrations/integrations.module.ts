import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../core/config/app-config';
import { LeadsModule } from '../leads/leads.module';
import { MarketingModule } from '../marketing/marketing.module';
import { OrganizationModule } from '../organization/organization.module';
import { SettingsModule } from '../settings/settings.module';
import { LiveSnsVerifier, SimulatedSnsVerifier, SNS_VERIFIER } from './adapters/sns-verifier';
import { InboundWebhooksController } from './inbound-webhooks.controller';
import { IncomingLeadIntake } from './inbox/incoming-lead-intake';
import { WebhookInbox } from './inbox/webhook-inbox';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { CALENDAR_OAUTH, LiveCalendarOAuth, SimulatedCalendarOAuth } from './adapters/calendar-oauth';
import { GraphMetaApi, META_API } from './meta/meta-api';
import { MetaWebhookController } from './meta/meta-webhook';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { WebhookSourcesController } from './webhook-sources.controller';
import { WebhookSourcesService } from './webhook-sources.service';

/**
 * Connections, inbound webhooks and provider adapters (SRS §11): Meta lead ads, the general webhook, property
 * portals and their lead emails, WhatsApp Business number, email sender; the Meta check (SRS §8.7).
 */
@Module({
  imports: [LeadsModule, SettingsModule, MarketingModule, OrganizationModule],
  controllers: [IntegrationsController, MetaWebhookController, WebhookSourcesController, InboundWebhooksController, ReconciliationController],
  providers: [
    IntegrationsService,
    WebhookInbox,
    IncomingLeadIntake,
    WebhookSourcesService,
    ReconciliationService,
    {
      provide: META_API,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new GraphMetaApi(config.META_APP_ID ?? '', config.META_APP_SECRET ?? '', config.META_GRAPH_VERSION),
    },
    {
      provide: CALENDAR_OAUTH,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) =>
        c.CALENDAR_MODE === 'live'
          ? new LiveCalendarOAuth({
              ...(c.GOOGLE_OAUTH_CLIENT_ID && c.GOOGLE_OAUTH_CLIENT_SECRET ? { google_workspace: { id: c.GOOGLE_OAUTH_CLIENT_ID, secret: c.GOOGLE_OAUTH_CLIENT_SECRET } } : {}),
              ...(c.MICROSOFT_OAUTH_CLIENT_ID && c.MICROSOFT_OAUTH_CLIENT_SECRET ? { microsoft_365: { id: c.MICROSOFT_OAUTH_CLIENT_ID, secret: c.MICROSOFT_OAUTH_CLIENT_SECRET } } : {}),
            })
          : new SimulatedCalendarOAuth(),
    },
    { provide: SNS_VERIFIER, inject: [APP_CONFIG], useFactory: (config: AppConfig) => (config.MESSAGING_MODE === 'live' ? new LiveSnsVerifier() : new SimulatedSnsVerifier()) },
  ],
  exports: [IntegrationsService, WebhookInbox],
})
export class IntegrationsModule {}
