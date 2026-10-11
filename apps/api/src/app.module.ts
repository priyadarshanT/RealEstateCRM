import { Module } from '@nestjs/common';
import { requestGuards } from './core/auth/auth.module';
import { CoreModule } from './core/core.module';
import { OrganizationModule } from './modules/organization/organization.module';

// Composition root: shared core plus one import per business module.
@Module({
  imports: [CoreModule, OrganizationModule],
  providers: [...requestGuards],
})
export class AppModule {}
