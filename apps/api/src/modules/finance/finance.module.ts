import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../core/config/app-config';
import { DealsModule } from '../deals/deals.module';
import { LeadsModule } from '../leads/leads.module';
import { OrganizationModule } from '../organization/organization.module';
import { ProjectsModule } from '../projects/projects.module';
import { SettingsModule } from '../settings/settings.module';
import { DOCUMENT_PDF, GotenbergDocumentPdf } from './adapters/document-pdf';
import { CommissionsService } from './commissions.service';
import { CounterpartiesService } from './counterparties.service';
import { DocumentsService } from './documents.service';
import { FinanceController } from './finance.controller';

/** Invoices and purchase orders (SRS §7): counterparties, documents with lines, payments, history, commissions. */
@Module({
  imports: [LeadsModule, ProjectsModule, DealsModule, OrganizationModule, SettingsModule],
  controllers: [FinanceController],
  providers: [
    CounterpartiesService,
    DocumentsService,
    CommissionsService,
    { provide: DOCUMENT_PDF, inject: [APP_CONFIG], useFactory: (c: AppConfig) => new GotenbergDocumentPdf(c.GOTENBERG_URL) },
  ],
  exports: [DocumentsService, CommissionsService, CounterpartiesService],
})
export class FinanceModule {}
