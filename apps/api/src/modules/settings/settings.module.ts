import { Module } from '@nestjs/common';
import { OrganizationModule } from '../organization/organization.module';
import { LeadSourcesController, LeadStagesController, LeadSubstatusesController, ReasonsController } from './lead-config.controller';
import { LeadConfigService } from './lead-config.service';
import { LeadConfigRepository } from './repositories/lead-config.repository';
import { SettingsRepository } from './repositories/settings.repository';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { WatermarkService } from './watermark.service';

/** Global Configuration: tenant settings, currencies, lead statuses and substatuses, reasons, lead sources. */
@Module({
  imports: [OrganizationModule],
  controllers: [SettingsController, LeadStagesController, LeadSubstatusesController, ReasonsController, LeadSourcesController],
  providers: [SettingsRepository, LeadConfigRepository, SettingsService, LeadConfigService, WatermarkService],
  exports: [SettingsService, LeadConfigService],
})
export class SettingsModule {}
