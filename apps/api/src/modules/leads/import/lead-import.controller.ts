import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequirePermission } from '../../../core/auth/decorators';
import { Principal } from '../../../core/auth/principal';
import { LeadImportDto, LeadImportService, StartImportDto } from './lead-import.service';

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
}
