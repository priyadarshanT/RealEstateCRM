import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { ProblemException, Problems } from '../../core/errors/problem';
import { FilesService } from '../../core/files/files.service';
import { decodeCursor, encodeCursor, Page } from '../../core/http/pagination';
import { QueueService, TenantJob } from '../../core/queue/queue.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { LeadScope } from '../leads/lead-scope';
import { LeadsService } from '../leads/leads.service';
import { CHANNEL_GATEWAY, ChannelGateway, OutboundMessage } from './adapters/channel-gateway';
import {
  ConsentDto,
  ConsentInputDto,
  ConversationDto,
  ConversationListQuery,
  MessageDto,
  MessageSendDto,
  REPLY_WINDOW_MS,
} from './dto/messaging.dto';
import { Channel, consents, ConversationRow, conversations, messages } from './messaging.schema';
import { notConnected, TemplatesService } from './templates.service';

export interface SendJob extends TenantJob {
  messageId: string;
  /** WhatsApp template values ({{1}}, {{2}}…), kept with the job because the message stores the filled text. */
  params?: string[];
}

const PROVIDER: Record<Channel, 'whatsapp_cloud' | 'email_ses'> = { whatsapp: 'whatsapp_cloud', email: 'email_ses' };
const LABEL: Record<Channel, string> = { whatsapp: 'WhatsApp', email: 'Email' };

/**
 * One-to-one WhatsApp and email (SRS §5.1–5.6): messages show on the lead's timeline, opted-out people are never
 * messaged, WhatsApp outside the 24-hour reply window needs an approved template. Sending happens in a queued job;
 * the status moves queued → sent → delivered → read (receipts by webhook) or failed.
 */
@Injectable()
export class MessagingService implements OnModuleInit {
  private readonly deliveredListeners: ((m: { campaignId: string | null; leadId: string; status: 'sent' | 'failed' }) => Promise<void>)[] = [];

  constructor(
    private readonly db: DbService,
    private readonly leads: LeadsService,
    private readonly scope: LeadScope,
    private readonly integrations: IntegrationsService,
    private readonly templates: TemplatesService,
    private readonly files: FilesService,
    private readonly queue: QueueService,
    @Inject(CHANNEL_GATEWAY) private readonly gateway: ChannelGateway,
  ) {}

  onModuleInit(): void {
    this.queue.register<SendJob>('send-message', (job) => this.deliver(job.messageId, job.params));
  }

  /** Called after each send attempt with its result (bulk campaigns track their recipients this way). */
  onDelivered(listener: (m: { campaignId: string | null; leadId: string; status: 'sent' | 'failed' }) => Promise<void>): void {
    this.deliveredListeners.push(listener);
  }

  // ---------------------------------------------------------------- sending
  async send(p: Principal, leadId: string, body: MessageSendDto): Promise<MessageDto> {
    const { lead } = await this.leads.editable(p, leadId);
    const address = body.channel === 'whatsapp' ? lead.phonePrimary : lead.email;
    if (!address) throw Problems.validation([{ field: 'channel', message: body.channel === 'whatsapp' ? 'the lead has no phone number' : 'the lead has no email address' }]);
    if (await this.optedOut(leadId, body.channel)) {
      throw new ProblemException(422, 'OPTED_OUT', 'Lead opted out', `This lead opted out of ${LABEL[body.channel]} messages.`);
    }
    const sender = await this.integrations.connectedSender(PROVIDER[body.channel]);
    if (!sender) throw notConnected(body.channel);
    const conversation = await this.conversationFor(leadId, body.channel, sender.id, address);

    let subject: string | null = body.subject ?? null;
    let text: string | null = body.body ?? null;
    let params: string[] | undefined;
    let templateName: string | undefined;
    if (body.templateId) {
      const template = await this.templates.get(body.templateId);
      if (template.channel !== body.channel) throw Problems.validation([{ field: 'templateId', message: `this is a ${LABEL[template.channel]} template` }]);
      if (template.status !== 'approved') throw new ProblemException(422, 'TEMPLATE_NOT_APPROVED', 'Template not approved', 'Only approved templates can be sent.');
      const rendered = this.templates.render(template, body.variables);
      subject = rendered.subject;
      text = rendered.body;
      params = rendered.params;
      templateName = template.name;
    } else if (body.channel === 'whatsapp' && !windowOpen(conversation)) {
      throw new ProblemException(422, 'TEMPLATE_REQUIRED', 'Template required', 'The lead has not written in the last 24 hours, so WhatsApp only allows an approved template.');
    }
    if (body.channel === 'email' && (!subject?.trim() || !text?.trim())) {
      throw Problems.validation([...(subject?.trim() ? [] : [{ field: 'subject', message: 'required' }]), ...(text?.trim() ? [] : [{ field: 'body', message: 'required' }])]);
    }
    if (!text?.trim() && !body.mediaFileId) throw Problems.validation([{ field: 'body', message: 'write a message or attach a file' }]);

    const now = new Date();
    const [message] = await this.db.current
      .insert(messages)
      .values({
        tenantId: p.tenantId,
        conversationId: conversation.id,
        leadId,
        direction: 'outbound',
        templateId: body.templateId ?? null,
        subject,
        body: text,
        mediaFileId: body.mediaFileId ?? null,
        status: 'queued',
        sentBy: p.userId,
      })
      .returning();
    await this.db.current.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conversation.id));
    await this.leads.addActivity(leadId, {
      type: body.channel,
      summary: `${LABEL[body.channel]} sent${templateName ? `: ${templateName}` : subject && body.channel === 'email' ? `: ${subject}` : ''}`,
      body: text ? text.slice(0, 1000) : null,
      actorUserId: p.userId,
      links: { messageId: message!.id },
    });
    // A message counts as acting on the lead (stops the 10-minute timer, SRS §3.4).
    await this.leads.recordAction(leadId, p.userId);
    await this.queue.send<SendJob>('send-message', { tenantId: p.tenantId, messageId: message!.id, ...(params ? { params } : {}) });
    return MessageDto.from(message!);
  }

  /** send-message job: hands the message to the provider and records the result. */
  async deliver(messageId: string, params?: string[]): Promise<void> {
    const [message] = await this.db.current.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!message || message.status !== 'queued') return;
    const [conversation] = await this.db.current.select().from(conversations).where(eq(conversations.id, message.conversationId)).limit(1);
    let outcome: 'sent' | 'failed' = 'failed';
    try {
      const sender = await this.integrations.get(conversation!.integrationId);
      if (sender.status !== 'connected') throw new Error(`The ${LABEL[conversation!.channel]} connection is ${sender.status}`);
      const outbound: OutboundMessage = { to: conversation!.contactAddress, subject: message.subject, body: message.body };
      if (message.templateId && conversation!.channel === 'whatsapp') {
        const template = await this.templates.get(message.templateId);
        outbound.template = { name: template.name, language: template.language, params: params ?? [] };
      }
      if (message.mediaFileId) {
        const link = await this.files.systemDownloadLink(message.mediaFileId);
        outbound.media = { url: link.url, fileName: 'attachment' };
      }
      const result = await this.gateway.send(
        { provider: sender.provider as 'whatsapp_cloud' | 'email_ses', settings: sender.settings, credentials: await this.integrations.credentials(sender) },
        outbound,
      );
      await this.db.current.update(messages).set({ status: 'sent', providerMessageId: result.providerMessageId, sentAt: new Date() }).where(eq(messages.id, messageId));
      outcome = 'sent';
    } catch (err) {
      await this.db.current
        .update(messages)
        .set({ status: 'failed', errorCode: 'SEND_FAILED', errorMessage: (err as Error).message.slice(0, 500) })
        .where(eq(messages.id, messageId));
    }
    for (const l of this.deliveredListeners) await l({ campaignId: message.campaignId, leadId: message.leadId, status: outcome });
  }

  // ---------------------------------------------------------------- conversations
  async listConversations(p: Principal, q: ConversationListQuery): Promise<Page<ConversationDto>> {
    const offset = q.cursor ? Number(decodeCursor(q.cursor, 1)[0]) : 0;
    const rows = await this.db.current
      .select()
      .from(conversations)
      .where(
        and(
          await this.scope.visibleLeadIdIn(p, conversations.leadId),
          q.channel ? eq(conversations.channel, q.channel) : undefined,
          q.leadId ? eq(conversations.leadId, q.leadId) : undefined,
          q.unread ? gt(conversations.unreadCount, 0) : undefined,
        ),
      )
      .orderBy(sql`${conversations.lastMessageAt} DESC NULLS LAST`, desc(conversations.id))
      .limit(q.limit + 1)
      .offset(offset);
    const hasMore = rows.length > q.limit;
    return { data: rows.slice(0, q.limit).map((c) => ConversationDto.from(c)), page: { nextCursor: hasMore ? encodeCursor([offset + q.limit]) : null, hasMore } };
  }

  async listMessages(p: Principal, conversationId: string, limit: number, cursor?: string): Promise<Page<MessageDto>> {
    await this.visibleConversation(p, conversationId);
    const where = [eq(messages.conversationId, conversationId)];
    if (cursor) {
      const [at, id] = decodeCursor(cursor, 2) as [string, string];
      where.push(sql`(${messages.createdAt}, ${messages.id}) < (${at}::timestamptz, ${id}::uuid)`);
    }
    const rows = await this.db.current
      .select()
      .from(messages)
      .where(and(...where))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const last = rows[limit - 1];
    return { data: rows.slice(0, limit).map(MessageDto.from), page: { nextCursor: hasMore && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null, hasMore } };
  }

  async markRead(p: Principal, conversationId: string): Promise<void> {
    await this.visibleConversation(p, conversationId);
    await this.db.current.update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, conversationId));
  }

  // ---------------------------------------------------------------- consent and opt-out
  async listConsents(p: Principal, leadId: string): Promise<ConsentDto[]> {
    await this.leads.visible(p, leadId);
    const rows = await this.db.current.select().from(consents).where(eq(consents.leadId, leadId)).orderBy(desc(consents.recordedAt), desc(consents.id));
    return rows.map(ConsentDto.from);
  }

  /** History is kept: each change is a new row; the latest row per channel wins (SRS §5.6). */
  async addConsent(p: Principal, leadId: string, body: ConsentInputDto): Promise<ConsentDto> {
    await this.leads.editable(p, leadId);
    const row = await this.recordConsent(leadId, body.channel, body.status, body.captureMethod, body.note ?? null, p.userId);
    await this.leads.addActivity(leadId, {
      type: 'system',
      summary: `${body.channel === 'sms' ? 'SMS' : LABEL[body.channel]}: ${body.status === 'opted_out' ? 'opted out' : 'opted in'}`,
      body: body.note ?? null,
      actorUserId: p.userId,
    });
    return ConsentDto.from(row);
  }

  async recordConsent(leadId: string, channel: 'whatsapp' | 'email' | 'sms', status: 'opted_in' | 'opted_out', captureMethod: ConsentInputDto['captureMethod'], note: string | null, userId: string | null) {
    const [row] = await this.db.current
      .insert(consents)
      .values({ tenantId: this.db.currentTenantId!, leadId, channel, status, captureMethod, note, recordedBy: userId })
      .returning();
    return row!;
  }

  async optedOut(leadId: string, channel: Channel): Promise<boolean> {
    const [latest] = await this.db.current
      .select({ status: consents.status })
      .from(consents)
      .where(and(eq(consents.leadId, leadId), eq(consents.channel, channel)))
      .orderBy(desc(consents.recordedAt), desc(consents.id))
      .limit(1);
    return latest?.status === 'opted_out';
  }

  // ---------------------------------------------------------------- helpers
  /** One thread per lead, channel and sending account (conversations are unique per account + address). */
  async conversationFor(leadId: string, channel: Channel, integrationId: string, address: string): Promise<ConversationRow> {
    await this.db.current
      .insert(conversations)
      .values({ tenantId: this.db.currentTenantId!, leadId, channel, integrationId, contactAddress: address })
      .onConflictDoNothing();
    const [row] = await this.db.current
      .select()
      .from(conversations)
      .where(and(eq(conversations.integrationId, integrationId), eq(conversations.contactAddress, address)))
      .limit(1);
    return row!;
  }

  private async visibleConversation(p: Principal, id: string): Promise<ConversationRow> {
    const [row] = await this.db.current
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), await this.scope.visibleLeadIdIn(p, conversations.leadId)))
      .limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }
}

function windowOpen(c: ConversationRow): boolean {
  return !!c.lastInboundAt && Date.now() - c.lastInboundAt.getTime() < REPLY_WINDOW_MS;
}

