import { Module } from '@nestjs/common';
import { PRINCIPAL_RESOLVER } from '../../core/auth/principal';
import { MeController } from './me.controller';
import { OrganizationRepository } from './organization.repository';
import { OrganizationService } from './organization.service';
import { OrganizationPrincipalResolver } from './principal-resolver';

@Module({
  controllers: [MeController],
  providers: [
    OrganizationRepository,
    OrganizationService,
    { provide: PRINCIPAL_RESOLVER, useClass: OrganizationPrincipalResolver },
  ],
  exports: [OrganizationService, PRINCIPAL_RESOLVER],
})
export class OrganizationModule {}
