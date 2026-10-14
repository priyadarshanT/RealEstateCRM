import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../core/config/app-config';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LeadsModule } from '../leads/leads.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { CHANNEL_GATEWAY, LiveChannelGateway, SimulatedChannelGateway } from './adapters/channel-gateway';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { InboundMessagingService } from './inbound.service';
import { ConversationsController, LeadMessagingController, TemplatesController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { TemplatesService } from './templates.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

/**
 * WhatsApp and email (SRS §5): templates, one-to-one conversations on the lead, bulk campaigns, consent and opt-out,
 * and the WhatsApp webhook (replies, receipts, template approvals).
 */
@Module({
  imports: [LeadsModule, IntegrationsModule, SettingsModule, NotificationsModule],
  controllers: [ConversationsController, LeadMessagingController, TemplatesController, CampaignsController, WhatsAppWebhookController],
  providers: [
    MessagingService,
    TemplatesService,
    CampaignsService,
    InboundMessagingService,
    {
      provide: CHANNEL_GATEWAY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => (config.MESSAGING_MODE === 'live' ? new LiveChannelGateway(config.META_GRAPH_VERSION, config.S3_REGION) : new SimulatedChannelGateway()),
    },
  ],
  exports: [MessagingService, TemplatesService, CampaignsService],
})
export class MessagingModule {}
