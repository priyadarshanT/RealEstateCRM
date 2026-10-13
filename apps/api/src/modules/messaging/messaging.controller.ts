import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequireAnyPermission, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { PageQuery } from '../../core/http/pagination';
import {
  ConsentDto,
  ConsentInputDto,
  ConsentList,
  ConversationListQuery,
  ConversationPage,
  MessageDto,
  MessagePage,
  MessageSendDto,
  TemplateDto,
  TemplateInputDto,
  TemplateListQuery,
  TemplatePage,
} from './dto/messaging.dto';
import { MessagingService } from './messaging.service';
import { TemplatesService } from './templates.service';

@ApiTags('WhatsApp & email')
@ApiBearerAuth('bearer')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  @RequirePermission('messages.send')
  @ApiOperation({ operationId: 'listConversations', summary: 'List conversations' })
  @ApiOkResponse({ type: ConversationPage })
  list(@CurrentPrincipal() p: Principal, @Query() query: ConversationListQuery): Promise<ConversationPage> {
    return this.messaging.listConversations(p, query);
  }

  @Get(':id/messages')
  @RequirePermission('messages.send')
  @ApiOperation({ operationId: 'listMessages', summary: 'List messages' })
  @ApiOkResponse({ type: MessagePage })
  messages(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Query() query: PageQuery): Promise<MessagePage> {
    return this.messaging.listMessages(p, id, query.limit, query.cursor);
  }

  @Post(':id/read')
  @HttpCode(204)
  @RequirePermission('messages.send')
  @ApiOperation({ operationId: 'markConversationRead', summary: 'Mark conversation read' })
  @ApiNoContentResponse()
  read(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.messaging.markRead(p, id);
  }
}

@ApiTags('WhatsApp & email')
@ApiBearerAuth('bearer')
@Controller('leads/:id')
export class LeadMessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Post('messages')
  @HttpCode(202)
  @RequirePermission('messages.send')
  @ApiOperation({ operationId: 'sendMessageToLead', summary: 'Send message to lead' })
  @ApiAcceptedResponse({ type: MessageDto })
  send(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: MessageSendDto): Promise<MessageDto> {
    return this.messaging.send(p, id, body);
  }

  @Get('consents')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getLeadConsentHistory', summary: 'Get lead consent history' })
  @ApiOkResponse({ type: ConsentList })
  async consents(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<ConsentList> {
    return { data: await this.messaging.listConsents(p, id) };
  }

  @Post('consents')
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'recordConsent', summary: 'Record consent' })
  @ApiCreatedResponse({ type: ConsentDto })
  recordConsent(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ConsentInputDto): Promise<ConsentDto> {
    return this.messaging.addConsent(p, id, body);
  }
}

@ApiTags('WhatsApp & email')
@ApiBearerAuth('bearer')
@Controller('message-templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequireAnyPermission('messages.send', 'settings.manage')
  @ApiOperation({ operationId: 'listMessageTemplates', summary: 'List message templates' })
  @ApiOkResponse({ type: TemplatePage })
  list(@Query() query: TemplateListQuery): Promise<TemplatePage> {
    return this.templates.list(query);
  }

  @Post()
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'createMessageTemplate', summary: 'Create message template' })
  @ApiCreatedResponse({ type: TemplateDto })
  create(@CurrentPrincipal() p: Principal, @Body() body: TemplateInputDto): Promise<TemplateDto> {
    return this.templates.create(p, body);
  }

  @Get(':id')
  @RequireAnyPermission('messages.send', 'settings.manage')
  @ApiOperation({ operationId: 'getMessageTemplate', summary: 'Get message template' })
  @ApiOkResponse({ type: TemplateDto })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<TemplateDto> {
    return TemplateDto.from(await this.templates.get(id));
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'updateMessageTemplate', summary: 'Update message template' })
  @ApiOkResponse({ type: TemplateDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: TemplateInputDto): Promise<TemplateDto> {
    return this.templates.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'deleteMessageTemplate', summary: 'Delete message template' })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.templates.remove(id);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'submitTemplateToWhatsapp', summary: 'Submit template to WhatsApp' })
  @ApiOkResponse({ type: TemplateDto })
  submit(@Param('id', ParseUUIDPipe) id: string): Promise<TemplateDto> {
    return this.templates.submit(id);
  }
}
