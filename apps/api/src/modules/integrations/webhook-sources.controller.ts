import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { WebhookMappingDto, WebhookSourceDto, WebhookSourceInputDto, WebhookSourcesService } from './webhook-sources.service';

@ApiTags('Integrations')
@ApiBearerAuth('bearer')
@Controller('webhook-sources')
@RequirePermission('settings.manage')
export class WebhookSourcesController {
  constructor(private readonly sources: WebhookSourcesService) {}

  @Post()
  @ApiOperation({ operationId: 'createGeneralWebhook', summary: 'Create general webhook' })
  @ApiCreatedResponse({ type: WebhookSourceDto })
  create(@CurrentPrincipal() p: Principal, @Body() body: WebhookSourceInputDto): Promise<WebhookSourceDto> {
    return this.sources.create(p, body);
  }

  @Put(':id/mapping')
  @ApiOperation({ operationId: 'updateWebhookFieldMapping', summary: 'Update webhook field mapping' })
  @ApiOkResponse({ type: WebhookSourceDto })
  mapping(@Param('id', ParseUUIDPipe) id: string, @Body() body: WebhookMappingDto): Promise<WebhookSourceDto> {
    return this.sources.updateMapping(id, body.fieldMapping);
  }

  @Post(':id/rotate-secret')
  @HttpCode(200)
  @ApiOperation({ operationId: 'rotateWebhookSecret', summary: 'Rotate webhook secret' })
  @ApiOkResponse({ type: WebhookSourceDto })
  rotate(@Param('id', ParseUUIDPipe) id: string): Promise<WebhookSourceDto> {
    return this.sources.rotateSecret(id);
  }
}
