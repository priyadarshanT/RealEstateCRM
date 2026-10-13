import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { PageInfo, PageQuery } from '../../../core/http/pagination';
import { IsUuid } from '../../../core/http/validators';
import { ConsentRow, ConversationRow, MessageRow, TemplateRow } from '../messaging.schema';

const CHANNELS = ['whatsapp', 'email'] as const;
const iso = (d: Date | null) => d?.toISOString() ?? null;
const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

/** WhatsApp lets a business reply freely for 24 hours after the lead's last message (SRS §5). */
export const REPLY_WINDOW_MS = 24 * 3_600_000;

// ---------------------------------------------------------------- components.schemas.Conversation
export class ConversationDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) leadId!: string;
  @ApiProperty({ enum: CHANNELS }) channel!: 'whatsapp' | 'email';
  @ApiProperty() contactAddress!: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) lastMessageAt!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) lastInboundAt!: string | null;
  @ApiProperty() unreadCount!: number;
  @ApiPropertyOptional({ readOnly: true, description: 'WhatsApp: free-form reply allowed (24 h since last inbound)' }) replyWindowOpen!: boolean;

  static from(c: ConversationRow, now = Date.now()): ConversationDto {
    return {
      id: c.id,
      leadId: c.leadId,
      channel: c.channel,
      contactAddress: c.contactAddress,
      lastMessageAt: iso(c.lastMessageAt),
      lastInboundAt: iso(c.lastInboundAt),
      unreadCount: c.unreadCount,
      replyWindowOpen: c.channel === 'email' || (!!c.lastInboundAt && now - c.lastInboundAt.getTime() < REPLY_WINDOW_MS),
    };
  }
}

export class ConversationPage {
  @ApiProperty({ type: [ConversationDto] }) data!: ConversationDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class ConversationListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(CHANNELS) channel?: 'whatsapp' | 'email';
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() unread?: boolean;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() leadId?: string;
}

// ---------------------------------------------------------------- components.schemas.Message
export class MessageDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) conversationId!: string;
  @ApiProperty({ format: 'uuid' }) leadId!: string;
  @ApiProperty({ enum: ['inbound', 'outbound'] }) direction!: 'inbound' | 'outbound';
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) templateId!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) campaignId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) subject!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) body!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) mediaFileId!: string | null;
  @ApiProperty({ enum: ['queued', 'sent', 'delivered', 'read', 'failed', 'received'] }) status!: MessageRow['status'];
  @ApiPropertyOptional({ type: String, nullable: true }) errorMessage!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) sentBy!: string | null;
  @ApiProperty({ format: 'date-time', readOnly: true }) createdAt!: string;

  static from(m: MessageRow): MessageDto {
    return {
      id: m.id,
      conversationId: m.conversationId,
      leadId: m.leadId,
      direction: m.direction,
      templateId: m.templateId,
      campaignId: m.campaignId,
      subject: m.subject,
      body: m.body,
      mediaFileId: m.mediaFileId,
      status: m.status,
      errorMessage: m.errorMessage,
      sentBy: m.sentBy,
      createdAt: m.createdAt.toISOString(),
    };
  }
}

export class MessagePage {
  @ApiProperty({ type: [MessageDto] }) data!: MessageDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

/** components.schemas.MessageSend. WhatsApp outside the 24-hour window needs an approved template. */
export class MessageSendDto {
  @ApiProperty({ enum: CHANNELS }) @IsIn(CHANNELS) channel!: 'whatsapp' | 'email';
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() templateId?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } }) @IsOptional() @IsObject() variables?: Record<string, string>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(4096) body?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() mediaFileId?: string;
}

// ---------------------------------------------------------------- components.schemas.Consent
const CONSENT_CHANNELS = ['whatsapp', 'email', 'sms'] as const;
const CAPTURE = ['form', 'import', 'reply', 'unsubscribe_link', 'manual', 'provider'] as const;

export class ConsentDto {
  @ApiProperty({ enum: CONSENT_CHANNELS }) channel!: ConsentRow['channel'];
  @ApiProperty({ enum: ['opted_in', 'opted_out'] }) status!: ConsentRow['status'];
  @ApiProperty({ enum: CAPTURE }) captureMethod!: ConsentRow['captureMethod'];
  @ApiPropertyOptional({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ format: 'date-time', readOnly: true }) recordedAt!: string;

  static from(c: ConsentRow): ConsentDto {
    return { channel: c.channel, status: c.status, captureMethod: c.captureMethod, note: c.note, recordedAt: c.recordedAt.toISOString() };
  }
}

export class ConsentList {
  @ApiProperty({ type: [ConsentDto] }) data!: ConsentDto[];
}

export class ConsentInputDto {
  @ApiProperty({ enum: CONSENT_CHANNELS }) @IsIn(CONSENT_CHANNELS) channel!: ConsentRow['channel'];
  @ApiProperty({ enum: ['opted_in', 'opted_out'] }) @IsIn(['opted_in', 'opted_out']) status!: ConsentRow['status'];
  @ApiProperty({ enum: CAPTURE }) @IsIn(CAPTURE) captureMethod!: ConsentRow['captureMethod'];
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) note?: string | null;
  @IsOptional() recordedAt?: unknown;
}

// ---------------------------------------------------------------- components.schemas.MessageTemplate
const CATEGORIES = ['marketing', 'utility', 'authentication', 'transactional'] as const;
const TEMPLATE_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'disabled'] as const;

export class TemplateVariableDto {
  @ApiProperty() @IsString() @Matches(/^[a-z][a-z0-9_]{0,39}$/, { message: 'variable names use lowercase letters, digits and _' }) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) example?: string;
}

export class TemplateDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ enum: CHANNELS }) channel!: 'whatsapp' | 'email';
  @ApiProperty() name!: string;
  @ApiProperty() language!: string;
  @ApiProperty({ enum: CATEGORIES }) category!: TemplateRow['category'];
  @ApiPropertyOptional({ type: String, nullable: true }) subject!: string | null;
  @ApiProperty() body!: string;
  @ApiPropertyOptional({ type: [TemplateVariableDto] }) variables!: { name: string; example?: string }[];
  @ApiProperty({ enum: TEMPLATE_STATUSES, readOnly: true }) status!: TemplateRow['status'];

  static from(t: TemplateRow): TemplateDto {
    return { id: t.id, channel: t.channel, name: t.name, language: t.language, category: t.category, subject: t.subject, body: t.body, variables: t.variables, status: t.status };
  }
}

export class TemplatePage {
  @ApiProperty({ type: [TemplateDto] }) data!: TemplateDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class TemplateListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(CHANNELS) channel?: 'whatsapp' | 'email';
  @ApiPropertyOptional() @IsOptional() @IsIn(TEMPLATE_STATUSES) status?: TemplateRow['status'];
}

/** POST and PATCH /message-templates (body: MessageTemplate). id and status are accepted but ignored. */
export class TemplateInputDto {
  @IsOptional() id?: unknown;
  @IsOptional() status?: unknown;
  @ApiPropertyOptional({ enum: CHANNELS }) @IsOptional() @IsIn(CHANNELS) channel?: 'whatsapp' | 'email';
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[a-z0-9_]{1,80}$/, { message: 'name uses lowercase letters, digits and _ (WhatsApp rule)' }) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[a-z]{2}(_[A-Z]{2})?$/, { message: 'language is a code such as en or ar' }) language?: string;
  @ApiPropertyOptional({ enum: CATEGORIES }) @IsOptional() @IsIn(CATEGORIES) category?: TemplateRow['category'];
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) subject?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(4096) body?: string;
  @ApiPropertyOptional({ type: [TemplateVariableDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TemplateVariableDto)
  variables?: TemplateVariableDto[];
}
