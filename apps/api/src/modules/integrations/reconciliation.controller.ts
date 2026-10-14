import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { ReconciliationDto, ReconciliationListQuery, ReconciliationPage, ReconciliationRunDto, ReconciliationService } from './reconciliation.service';

/** Meta check (SRS §8.7): Reports in the contract; the runs belong to the integration they check. */
@ApiTags('Reports')
@ApiBearerAuth('bearer')
@Controller()
@RequirePermission('settings.manage')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Post('integrations/:id/reconciliations')
  @HttpCode(202)
  @ApiOperation({ operationId: 'runMetaReconciliation', summary: 'Run Meta reconciliation' })
  @ApiResponse({ status: 202, type: ReconciliationDto })
  run(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReconciliationRunDto): Promise<ReconciliationDto> {
    return this.reconciliation.start(p, id, body);
  }

  @Get('reconciliations')
  @ApiOperation({ operationId: 'listReconciliationRuns', summary: 'List reconciliation runs' })
  @ApiOkResponse({ type: ReconciliationPage })
  list(@Query() query: ReconciliationListQuery): Promise<ReconciliationPage> {
    return this.reconciliation.list(query);
  }
}
