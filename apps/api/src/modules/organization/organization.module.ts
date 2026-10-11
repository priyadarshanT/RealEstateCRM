import { Module } from '@nestjs/common';
import { PRINCIPAL_RESOLVER } from '../../core/auth/principal';
import { MeController, OrganizationController } from './controllers/organization.controller';
import { RolesController } from './controllers/roles.controller';
import { DivisionsController, TeamsController } from './controllers/teams.controller';
import { UsersController } from './controllers/users.controller';
import { OrganizationService } from './organization.service';
import { OrganizationPrincipalResolver } from './principal-resolver';
import { RolesRepository } from './repositories/roles.repository';
import { TeamsRepository } from './repositories/teams.repository';
import { TenantRepository } from './repositories/tenant.repository';
import { UsersRepository } from './repositories/users.repository';
import { RolesService } from './roles.service';
import { TeamsService } from './teams.service';
import { UsersService } from './users.service';

/** Tenants, users, roles and permissions, teams and divisions (SRS §4). */
@Module({
  controllers: [MeController, OrganizationController, UsersController, RolesController, TeamsController, DivisionsController],
  providers: [
    TenantRepository,
    UsersRepository,
    RolesRepository,
    TeamsRepository,
    OrganizationService,
    UsersService,
    RolesService,
    TeamsService,
    { provide: PRINCIPAL_RESOLVER, useClass: OrganizationPrincipalResolver },
  ],
  exports: [OrganizationService, UsersService, PRINCIPAL_RESOLVER],
})
export class OrganizationModule {}
