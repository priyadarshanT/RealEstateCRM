import { Module } from '@nestjs/common';
import { OrganizationModule } from '../organization/organization.module';
import { LeadSourcesController, LeadStagesController, ReasonsController } from './lead-config.controller';
import { LeadConfigService } from './lead-config.service';
import { LeadConfigRepository } from './repositories/lead-config.repository';
import { SettingsRepository } from './repositories/settings.repository';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/** Settings: tenant settings, currencies, lead stages, reasons, lead sources (SRS §11.5). */
@Module({
  imports: [OrganizationModule],
  controllers: [SettingsController, LeadStagesController, ReasonsController, LeadSourcesController],
  providers: [SettingsRepository, LeadConfigRepository, SettingsService, LeadConfigService],
  exports: [SettingsService, LeadConfigService],
})
export class SettingsModule {}
