import { Module } from '@nestjs/common';
import { requestGuards } from './core/auth/auth.module';
import { CoreModule } from './core/core.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { LeadsModule } from './modules/leads/leads.module';
import { SettingsModule } from './modules/settings/settings.module';

// Composition root: shared core plus one import per business module.
@Module({
  imports: [CoreModule, OrganizationModule, SettingsModule, LeadsModule],
  providers: [...requestGuards],
})
export class AppModule {}
