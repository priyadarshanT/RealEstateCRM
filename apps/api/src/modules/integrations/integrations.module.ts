import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../core/config/app-config';
import { LeadsModule } from '../leads/leads.module';
import { MarketingModule } from '../marketing/marketing.module';
import { OrganizationModule } from '../organization/organization.module';
import { SettingsModule } from '../settings/settings.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { GraphMetaApi, META_API } from './meta/meta-api';
import { MetaLeadIntake, MetaWebhookController } from './meta/meta-webhook';

/** Connections, inbound webhooks and provider adapters (SRS §11): Meta lead ads, WhatsApp Business number, email sender. */
@Module({
  imports: [LeadsModule, SettingsModule, MarketingModule, OrganizationModule],
  controllers: [IntegrationsController, MetaWebhookController],
  providers: [
    IntegrationsService,
    MetaLeadIntake,
    {
      provide: META_API,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new GraphMetaApi(config.META_APP_ID ?? '', config.META_APP_SECRET ?? '', config.META_GRAPH_VERSION),
    },
  ],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
