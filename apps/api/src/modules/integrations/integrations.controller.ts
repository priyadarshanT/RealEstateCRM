import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Response } from 'express';
import { CurrentPrincipal, Public, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { PageQuery } from '../../core/http/pagination';
import {
  ConnectStartDto,
  IntegrationConnectDto,
  IntegrationDto,
  IntegrationList,
  IntegrationsService,
  IntegrationUpdateDto,
  SyncRunPage,
  WebhookEventDto,
  WebhookEventPage,
} from './integrations.service';

class EventQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) status?: string;
}

class TestResult {
  @ApiProperty() ok!: boolean;
  @ApiProperty() detail!: string;
}

class RetryResult {
  @ApiProperty() requeued!: number;
}

@ApiTags('Integrations')
@ApiBearerAuth('bearer')
@Controller()
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('integrations')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'listIntegrations', summary: 'List connections' })
  @ApiOkResponse({ type: IntegrationList })
  async list(@CurrentPrincipal() p: Principal): Promise<IntegrationList> {
    return { data: await this.integrations.list(p) };
  }

  @Post('integrations')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'connectIntegration', summary: 'Connect an account' })
  @ApiCreatedResponse({ type: ConnectStartDto })
  connect(@CurrentPrincipal() p: Principal, @Body() body: IntegrationConnectDto): Promise<ConnectStartDto> {
    return this.integrations.connect(p, body);
  }

  @Get('integrations/:id')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'getIntegration', summary: 'Get a connection' })
  @ApiOkResponse({ type: IntegrationDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<IntegrationDto> {
    return this.integrations.getDto(id);
  }

  @Patch('integrations/:id')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'updateIntegrationSettings', summary: 'Change connection settings' })
  @ApiOkResponse({ type: IntegrationDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: IntegrationUpdateDto): Promise<IntegrationDto> {
    return this.integrations.update(id, body);
  }

  @Delete('integrations/:id')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'disconnectIntegration', summary: 'Disconnect' })
  @ApiNoContentResponse({ description: 'Done' })
  disconnect(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.integrations.disconnect(id);
  }

  @Post('integrations/:id/test')
  @HttpCode(200)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'testIntegration', summary: 'Test the connection' })
  @ApiOkResponse({ type: TestResult })
  test(@Param('id', ParseUUIDPipe) id: string): Promise<TestResult> {
    return this.integrations.test(id);
  }

  @Post('integrations/:id/retry')
  @HttpCode(202)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'retryFailedEvents', summary: 'Retry failed incoming data' })
  @ApiResponse({ status: 202, type: RetryResult })
  async retry(@Param('id', ParseUUIDPipe) id: string): Promise<RetryResult> {
    return { requeued: await this.integrations.retryFailed(id) };
  }

  @Get('integrations/:id/sync-runs')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'listSyncRuns', summary: 'Sync runs' })
  @ApiOkResponse({ type: SyncRunPage })
  syncRuns(@Param('id', ParseUUIDPipe) id: string, @Query() query: PageQuery): Promise<SyncRunPage> {
    return this.integrations.syncRuns(id, query.limit, query.cursor);
  }

  @Get('integrations/:id/events')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'listIncomingEvents', summary: 'Incoming events' })
  @ApiOkResponse({ type: WebhookEventPage })
  events(@Param('id', ParseUUIDPipe) id: string, @Query() query: EventQuery): Promise<WebhookEventPage> {
    return this.integrations.events(id, query.limit, query.cursor, query.status);
  }

  @Post('webhook-events/:id/retry')
  @HttpCode(202)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'retryOneIncomingEvent', summary: 'Retry one incoming event' })
  @ApiResponse({ status: 202, type: WebhookEventDto })
  retryOne(@Param('id', ParseUUIDPipe) id: string): Promise<WebhookEventDto> {
    return this.integrations.retryOne(id);
  }

  @Get('oauth/:provider/callback')
  @Public()
  @ApiOperation({ operationId: 'oauthCallback', summary: 'OAuth redirect from the provider' })
  @ApiResponse({ status: 302, description: 'Redirects back to the Integrations screen' })
  async callback(@Param('provider') provider: string, @Query('code') code: string | undefined, @Query('state') state: string, @Res() res: Response): Promise<void> {
    res.redirect(302, await this.integrations.finishOAuth(provider, code, state ?? ''));
  }
}
