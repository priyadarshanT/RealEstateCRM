import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { DbService } from '../../core/database/db.service';
import { QueueService } from '../../core/queue/queue.service';
import { InboxJob, PermanentEventError, WebhookInbox } from '../integrations/inbox/webhook-inbox';
import { IntegrationRow } from '../integrations/integrations.schema';
import { LeadIntakeService, normalizePhone } from '../leads/lead-intake.service';
import { LeadsService } from '../leads/leads.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LeadConfigService } from '../settings/lead-config.service';
import { CampaignsService } from './campaigns.service';
import { conversations, messages } from './messaging.schema';
import { MessagingService } from './messaging.service';
import { TemplatesService } from './templates.service';

/** One inbound WhatsApp message as Meta sends it. */
export interface WaInboundMessage {
  id: string;
  from: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { caption?: string };
  document?: { caption?: string; filename?: string };
}

/** A delivery status for a message we sent. */
export interface WaStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | string;
  timestamp?: string;
  errors?: { code?: number; title?: string; message?: string }[];
}

export type WhatsAppEvent =
  | { kind: 'message'; message: WaInboundMessage; contactName: string | null }
  | { kind: 'status'; status: WaStatus }
  | { kind: 'template'; providerTemplateId: string; event: string; reason: string | null };

/** Replies that opt the person out of WhatsApp (SRS §5.6), compared without case or punctuation. */
const OPT_OUT_WORDS = new Set(['stop', 'stop all', 'unsubscribe', 'opt out', 'optout', 'cancel', 'إيقاف', 'ايقاف', 'الغاء', 'إلغاء']);

/**
 * message-status job: WhatsApp replies land on the lead's timeline (an unknown number becomes a new WhatsApp lead),
 * the 24-hour reply window opens, the owner is notified; receipts move messages to delivered / read / failed;
 * campaign recipients become replied or opted out; template approvals from Meta update the template.
 */
@Injectable()
export class InboundMessagingService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly queue: QueueService,
    private readonly inbox: WebhookInbox,
    private readonly messaging: MessagingService,
    private readonly campaigns: CampaignsService,
    private readonly templates: TemplatesService,
    private readonly leads: LeadsService,
    private readonly intake: LeadIntakeService,
    private readonly sources: LeadConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.queue.register<InboxJob>('message-status', (job) => this.process(job.webhookEventId));
  }

  process(eventId: string): Promise<void> {
    return this.inbox.process('message-status', eventId, async (event, integration) => {
      const e = event.payload as unknown as WhatsAppEvent;
      if (e.kind === 'message') await this.received(integration, e.message, e.contactName);
      else if (e.kind === 'status') await this.status(e.status);
      else await this.templateReview(e.providerTemplateId, e.event);
    });
  }

  private async received(integration: IntegrationRow, m: WaInboundMessage, contactName: string | null): Promise<void> {
    const from = normalizePhone(`+${m.from.replace(/^\+/, '')}`);
    if (!from) throw new PermanentEventError(`Invalid sender number ${m.from}`);
    const at = m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date();
    const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.image?.caption ?? m.document?.caption ?? `[${m.type ?? 'message'}]`;

    const [known] = await this.db.current
      .select()
      .from(conversations)
      .where(and(eq(conversations.integrationId, integration.id), eq(conversations.contactAddress, from)))
      .limit(1);
    let leadId = known?.leadId ?? (await this.leads.findByContact(from, null))?.id;
    if (!leadId) {
      // A new number writing to the company is a new WhatsApp lead (SRS §2.1), assigned by the rules.
      const result = await this.intake.receive({ sourceId: await this.whatsappSource(), fullName: contactName, phone: from, integrationId: integration.id, externalSubmissionId: m.id, formAnswers: { message: text }, submittedAt: at });
      if (result.status === 'rejected') throw new PermanentEventError(result.errors.join('; '));
      if (!('leadId' in result) || !result.leadId) return;
      leadId = result.leadId;
    }
    const conversation = known ?? (await this.messaging.conversationFor(leadId, 'whatsapp', integration.id, from));

    const [message] = await this.db.current
      .insert(messages)
      .values({ tenantId: this.db.currentTenantId!, conversationId: conversation.id, leadId, direction: 'inbound', body: text, providerMessageId: m.id, status: 'received', createdAt: at })
      .returning();
    await this.db.current
      .update(conversations)
      .set({ lastInboundAt: at, lastMessageAt: at, unreadCount: sql`${conversations.unreadCount} + 1` })
      .where(eq(conversations.id, conversation.id));
    await this.leads.addActivity(leadId, { type: 'whatsapp', summary: 'WhatsApp received', body: text.slice(0, 1000), actorUserId: null, links: { messageId: message!.id } });
    await this.leads.recordInbound(leadId, at);

    // A reply to a bulk campaign counts on the campaign report (SRS §5.5).
    const [lastCampaignMessage] = await this.db.current
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.conversationId, conversation.id), eq(messages.direction, 'outbound'), isNotNull(messages.campaignId)))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    const optOut = OPT_OUT_WORDS.has(text.toLowerCase().replace(/[^\p{L}\s]/gu, '').trim());
    if (lastCampaignMessage) await this.campaigns.recipientUpdate(lastCampaignMessage.id, optOut ? 'opted_out' : 'replied');
    if (optOut) {
      await this.messaging.recordConsent(leadId, 'whatsapp', 'opted_out', 'reply', `Replied "${text.slice(0, 100)}"`, null);
      await this.leads.addActivity(leadId, { type: 'system', summary: 'WhatsApp: opted out', body: `Replied "${text.slice(0, 100)}"`, actorUserId: null });
    }

    const lead = await this.leads.findRow(leadId);
    if (lead?.ownerUserId) {
      await this.notifications.notify({ userId: lead.ownerUserId, type: 'message_received', title: `WhatsApp from ${lead.fullName}`, body: text.slice(0, 140), leadId });
    }
  }

  /** Receipts only move forward: queued → sent → delivered → read; failed records Meta's error. */
  private async status(s: WaStatus): Promise<void> {
    const [message] = await this.db.current.select().from(messages).where(and(eq(messages.providerMessageId, s.id), eq(messages.direction, 'outbound'))).limit(1);
    // The receipt can arrive before the send job saved Meta's message ID: retried later.
    if (!message) throw new Error(`Message ${s.id} not found yet`);
    const at = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
    const order = ['queued', 'sent', 'delivered', 'read'];
    if (s.status === 'failed') {
      const error = s.errors?.[0];
      await this.db.current
        .update(messages)
        .set({ status: 'failed', errorCode: error?.code ? String(error.code) : 'DELIVERY_FAILED', errorMessage: (error?.message ?? error?.title ?? 'Not delivered').slice(0, 500) })
        .where(eq(messages.id, message.id));
      return;
    }
    if (!order.includes(s.status) || order.indexOf(s.status) <= order.indexOf(message.status)) return;
    await this.db.current
      .update(messages)
      .set({
        status: s.status as 'sent' | 'delivered' | 'read',
        ...(s.status === 'sent' ? { sentAt: message.sentAt ?? at } : {}),
        ...(s.status === 'delivered' || s.status === 'read' ? { deliveredAt: message.deliveredAt ?? at } : {}),
        ...(s.status === 'read' ? { readAt: at } : {}),
      })
      .where(eq(messages.id, message.id));
    if (s.status === 'delivered' || s.status === 'read') await this.campaigns.recipientUpdate(message.id, 'delivered');
  }

  private async templateReview(providerTemplateId: string, event: string): Promise<void> {
    const status = ({ APPROVED: 'approved', REJECTED: 'rejected', DISABLED: 'disabled' } as const)[event.toUpperCase() as 'APPROVED'];
    if (status) await this.templates.setReviewResult(providerTemplateId, status);
  }

  private async whatsappSource(): Promise<string> {
    const existing = await this.sources.sourceByType('whatsapp');
    if (existing) return existing.id;
    return (await this.sources.createSource({ type: 'whatsapp', name: 'WhatsApp', qualityScore: 60 })).id;
  }
}
