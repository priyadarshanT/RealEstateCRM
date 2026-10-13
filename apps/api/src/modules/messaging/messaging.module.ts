import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../core/config/app-config';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LeadsModule } from '../leads/leads.module';
import { CHANNEL_GATEWAY, LiveChannelGateway, SimulatedChannelGateway } from './adapters/channel-gateway';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { ConversationsController, LeadMessagingController, TemplatesController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { TemplatesService } from './templates.service';

/** WhatsApp and email (SRS §5): templates, one-to-one conversations on the lead, bulk campaigns, consent and opt-out. */
@Module({
  imports: [LeadsModule, IntegrationsModule],
  controllers: [ConversationsController, LeadMessagingController, TemplatesController, CampaignsController],
  providers: [
    MessagingService,
    TemplatesService,
    CampaignsService,
    {
      provide: CHANNEL_GATEWAY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => (config.MESSAGING_MODE === 'live' ? new LiveChannelGateway(config.META_GRAPH_VERSION, config.S3_REGION) : new SimulatedChannelGateway()),
    },
  ],
  exports: [MessagingService, TemplatesService, CampaignsService],
})
export class MessagingModule {}
