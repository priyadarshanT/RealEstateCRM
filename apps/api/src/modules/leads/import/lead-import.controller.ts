import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, StreamableFile } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequirePermission } from '../../../core/auth/decorators';
import { Principal } from '../../../core/auth/principal';
import { LeadImportDto, LeadImportList, LeadImportService, StartImportDto } from './lead-import.service';

@ApiTags('Leads')
@ApiBearerAuth('bearer')
@Controller('leads/imports')
export class LeadImportController {
  constructor(private readonly imports: LeadImportService) {}

  @Post()
  @RequirePermission('leads.import')
  @ApiOperation({ operationId: 'startLeadImport', summary: 'Upload an Excel/CSV and preview it' })
  @ApiCreatedResponse({ type: LeadImportDto })
  start(@CurrentPrincipal() p: Principal, @Body() body: StartImportDto): Promise<LeadImportDto> {
    return this.imports.start(p, body);
  }

  @Get()
  @RequirePermission('leads.import')
  @ApiOperation({ operationId: 'listLeadImports', summary: 'Import batches with their counts' })
  @ApiOkResponse({ type: LeadImportList })
  async list(): Promise<LeadImportList> {
    return { data: await this.imports.list() };
  }

  @Get('template')
  @RequirePermission('leads.import')
  @ApiOperation({ operationId: 'downloadLeadImportTemplate', summary: 'Excel template for a migration' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOkResponse({ description: 'Excel file' })
  async template(): Promise<StreamableFile> {
    return new StreamableFile(await this.imports.template(), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="lead-migration-template.xlsx"',
    });
  }

  @Get(':id')
  @RequirePermission('leads.import')
  @ApiOperation({ operationId: 'getLeadImport', summary: 'Import status' })
  @ApiOkResponse({ type: LeadImportDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<LeadImportDto> {
    return this.imports.get(id);
  }

  @Post(':id/confirm')
  @HttpCode(202)
  @RequirePermission('leads.import')
  @ApiOperation({ operationId: 'confirmLeadImport', summary: 'Import the previewed file' })
  @ApiAcceptedResponse({ type: LeadImportDto })
  confirm(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<LeadImportDto> {
    return this.imports.confirm(p, id);
  }

  @Post(':id/retry')
  @HttpCode(202)
  @RequirePermission('leads.import')
  @ApiOperation({ operationId: 'retryLeadImport', summary: 'Run a failed import again (no duplicates)' })
  @ApiAcceptedResponse({ type: LeadImportDto })
  retry(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<LeadImportDto> {
    return this.imports.retry(p, id);
  }
}
