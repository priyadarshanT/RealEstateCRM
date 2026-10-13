import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { ProblemException, Problems } from '../../core/errors/problem';
import { decodeCursor, encodeCursor, Page } from '../../core/http/pagination';
import { QueueService, TenantJob } from '../../core/queue/queue.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { LeadListQuery } from '../leads/dto/lead.dto';
import { LeadsService } from '../leads/leads.service';
import { CHANNEL_GATEWAY, ChannelGateway } from './adapters/channel-gateway';
import { AudiencePreviewDto, CampaignDto, CampaignInputDto, CampaignListQuery, CampaignReportDto } from './dto/campaign.dto';
import { CampaignRow, messageCampaignRecipients, messageCampaigns, messages, TemplateRow } from './messaging.schema';
import { MessagingService, SendJob } from './messaging.service';
import { notConnected, TemplatesService } from './templates.service';

interface DispatchJob extends TenantJob {
  campaignId: string;
}

/** Audience filter keys: the lead list filters (GET /leads), applied within the campaign creator's data scope. */
const AUDIENCE_KEYS = ['tab', 'q', 'stageId', 'ownerUserId', 'teamId', 'projectId', 'sourceId', 'campaignId', 'eventId', 'budgetMin', 'budgetMax', 'createdFrom', 'createdTo'];
/** Placeholders a campaign fills from each lead; campaigns have no per-message values. */
const LEAD_FIELDS = ['first_name', 'full_name'];
const PAGE = 200;
const EDITABLE: CampaignRow['status'][] = ['draft', 'rejected'];

/**
 * Bulk WhatsApp / email campaigns (SRS §5.3–5.5): pick an audience, template and schedule, send a test, a manager
 * approves, then each recipient gets the message through the send-message job. Opted-out people are left out, also
 * if they opt out between approval and sending (SRS §15.9).
 */
@Injectable()
export class CampaignsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly leads: LeadsService,
    private readonly integrations: IntegrationsService,
    private readonly templates: TemplatesService,
    private readonly messaging: MessagingService,
    private readonly queue: QueueService,
    @Inject(CHANNEL_GATEWAY) private readonly gateway: ChannelGateway,
  ) {}

  onModuleInit(): void {
    this.queue.register<DispatchJob>('campaign-dispatch', (job) => this.dispatch(job.campaignId));
    // A campaign message reached its final send result: update the recipient and finish the campaign.
    this.messaging.onDelivered(async (m) => {
      if (m.campaignId) await this.recipientResult(m.campaignId, m.leadId, m.status === 'sent' ? 'sent' : 'failed');
    });
  }

  async list(q: CampaignListQuery): Promise<Page<CampaignDto>> {
    const offset = q.cursor ? Number(decodeCursor(q.cursor, 1)[0]) : 0;
    const rows = await this.db.current
      .select()
      .from(messageCampaigns)
      .where(q.status ? eq(messageCampaigns.status, q.status) : undefined)
      .orderBy(desc(messageCampaigns.createdAt), desc(messageCampaigns.id))
      .limit(q.limit + 1)
      .offset(offset);
    const hasMore = rows.length > q.limit;
    return { data: rows.slice(0, q.limit).map(CampaignDto.from), page: { nextCursor: hasMore ? encodeCursor([offset + q.limit]) : null, hasMore } };
  }

  async get(id: string): Promise<CampaignRow> {
    const [row] = await this.db.current.select().from(messageCampaigns).where(eq(messageCampaigns.id, id)).limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }

  async create(p: Principal, body: CampaignInputDto): Promise<CampaignDto> {
    const missing = (['name', 'channel', 'templateId', 'audienceFilter'] as const).filter((k) => !body[k]).map((field) => ({ field, message: 'required' }));
    if (missing.length) throw Problems.validation(missing);
    await this.checkTemplate(body.templateId!, body.channel!);
    const audienceFilter = await checkAudience(body.audienceFilter!);
    const integrationId = await this.senderFor(body.channel!, body.integrationId);
    const [row] = await this.db.current
      .insert(messageCampaigns)
      .values({
        tenantId: p.tenantId,
        name: body.name!,
        channel: body.channel!,
        templateId: body.templateId!,
        integrationId,
        audienceFilter,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        createdBy: p.userId,
      })
      .returning();
    await this.audit.record('create', 'message_campaigns', row!.id, { name: [null, row!.name] });
    return CampaignDto.from(row!);
  }

  /** Only while draft or rejected; a change needs a new test before it can be submitted again. */
  async update(id: string, body: CampaignInputDto): Promise<CampaignDto> {
    const before = await this.get(id);
    if (!EDITABLE.includes(before.status)) throw new ProblemException(409, 'CONFLICT', 'Campaign cannot change', 'Only draft or rejected campaigns can be changed.');
    const channel = body.channel ?? before.channel;
    const templateId = body.templateId ?? before.templateId;
    if (body.channel || body.templateId) await this.checkTemplate(templateId, channel);
    const [row] = await this.db.current
      .update(messageCampaigns)
      .set({
        name: body.name ?? before.name,
        channel,
        templateId,
        integrationId: body.channel || body.integrationId ? await this.senderFor(channel, body.integrationId) : before.integrationId,
        audienceFilter: body.audienceFilter ? await checkAudience(body.audienceFilter) : before.audienceFilter,
        scheduledAt: body.scheduledAt === undefined ? before.scheduledAt : body.scheduledAt ? new Date(body.scheduledAt) : null,
        status: 'draft',
        rejectionNote: null,
        testSentAt: null,
        updatedAt: new Date(),
      })
      .where(eq(messageCampaigns.id, id))
      .returning();
    await this.audit.record('update', 'message_campaigns', id, { status: [before.status, 'draft'] });
    return CampaignDto.from(row!);
  }

  /** Who would receive it now (creator's scope), how many are left out because they opted out, and a sample. */
  async previewAudience(p: Principal, id: string): Promise<AudiencePreviewDto> {
    const campaign = await this.get(id);
    const audience = await this.resolveAudience(p, campaign);
    const reachable = audience.filter((a) => !a.optedOut);
    return { count: reachable.length, excludedOptedOut: audience.length - reachable.length, sample: reachable.slice(0, 5).map((a) => ({ id: a.leadId, name: a.name })) };
  }

  /** Sends the message to one test address (sample values for the lead fields). Required before submitting. */
  async sendTest(id: string, to: string): Promise<void> {
    const campaign = await this.get(id);
    const address = to.trim();
    if (campaign.channel === 'whatsapp' && !/^\+[1-9][0-9]{6,14}$/.test(address)) throw Problems.validation([{ field: 'to', message: 'a phone number in E.164 format, e.g. +971501234567' }]);
    if (campaign.channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw Problems.validation([{ field: 'to', message: 'an email address' }]);
    const template = await this.templates.get(campaign.templateId);
    const rendered = this.templates.render(template, { first_name: 'Test', full_name: 'Test Lead' });
    const sender = await this.integrations.get(campaign.integrationId);
    await this.gateway.send(
      { provider: sender.provider as 'whatsapp_cloud' | 'email_ses', settings: sender.settings, credentials: await this.integrations.credentials(sender) },
      {
        to: address,
        subject: rendered.subject,
        body: rendered.body,
        ...(campaign.channel === 'whatsapp' ? { template: { name: template.name, language: template.language, params: rendered.params } } : {}),
      },
    );
    await this.db.current.update(messageCampaigns).set({ testSentAt: new Date(), testRecipient: address, updatedAt: new Date() }).where(eq(messageCampaigns.id, id));
    await this.audit.record('update', 'message_campaigns', id, { testRecipient: [campaign.testRecipient, address] });
  }

  /** Submits for approval: the audience is fixed now (creator's scope); opted-out leads are recorded as skipped. */
  async submit(p: Principal, id: string): Promise<CampaignDto> {
    const campaign = await this.get(id);
    if (!EDITABLE.includes(campaign.status)) throw new ProblemException(409, 'CONFLICT', 'Already submitted', `The campaign is ${campaign.status.replace('_', ' ')}.`);
    if (!campaign.testSentAt) throw new ProblemException(422, 'TEST_REQUIRED', 'Send a test first', 'Send a test message and check it before submitting the campaign.');
    const audience = await this.resolveAudience(p, campaign);
    if (!audience.some((a) => !a.optedOut)) throw Problems.validation([{ field: 'audienceFilter', message: 'no lead in the audience can receive this message' }]);
    await this.db.current.delete(messageCampaignRecipients).where(eq(messageCampaignRecipients.campaignId, id));
    for (let i = 0; i < audience.length; i += 500) {
      await this.db.current.insert(messageCampaignRecipients).values(
        audience.slice(i, i + 500).map((a) => ({ tenantId: p.tenantId, campaignId: id, leadId: a.leadId, address: a.address, status: a.optedOut ? ('skipped_opted_out' as const) : ('pending' as const) })),
      );
    }
    const reachable = audience.filter((a) => !a.optedOut).length;
    const [row] = await this.db.current
      .update(messageCampaigns)
      .set({ status: 'pending_approval', audienceCount: reachable, rejectionNote: null, updatedAt: new Date() })
      .where(eq(messageCampaigns.id, id))
      .returning();
    await this.audit.record('update', 'message_campaigns', id, { status: [campaign.status, 'pending_approval'], audienceCount: [campaign.audienceCount, reachable] });
    return CampaignDto.from(row!);
  }

  /** A manager approves (never the creator). It is sent at the scheduled time, or now. */
  async approve(p: Principal, id: string): Promise<CampaignDto> {
    const campaign = await this.get(id);
    if (campaign.status !== 'pending_approval') throw new ProblemException(409, 'CONFLICT', 'Not waiting for approval', `The campaign is ${campaign.status.replace('_', ' ')}.`);
    if (campaign.createdBy === p.userId) throw new ProblemException(422, 'SELF_APPROVAL', 'Cannot approve your own campaign', 'Another manager must approve a campaign you created.');
    const [row] = await this.db.current
      .update(messageCampaigns)
      .set({ status: 'approved', approvedBy: p.userId, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(messageCampaigns.id, id))
      .returning();
    const startAfter = campaign.scheduledAt && campaign.scheduledAt > new Date() ? campaign.scheduledAt : undefined;
    await this.queue.send<DispatchJob>('campaign-dispatch', { tenantId: p.tenantId, campaignId: id }, startAfter ? { startAfter } : {});
    await this.audit.record('update', 'message_campaigns', id, { status: ['pending_approval', 'approved'] });
    return CampaignDto.from(row!);
  }

  async reject(p: Principal, id: string, note: string): Promise<CampaignDto> {
    const campaign = await this.get(id);
    if (campaign.status !== 'pending_approval') throw new ProblemException(409, 'CONFLICT', 'Not waiting for approval', `The campaign is ${campaign.status.replace('_', ' ')}.`);
    const [row] = await this.db.current
      .update(messageCampaigns)
      .set({ status: 'rejected', approvedBy: campaign.createdBy === p.userId ? null : p.userId, rejectionNote: note.trim(), updatedAt: new Date() })
      .where(eq(messageCampaigns.id, id))
      .returning();
    await this.audit.record('update', 'message_campaigns', id, { status: ['pending_approval', 'rejected'] });
    return CampaignDto.from(row!);
  }

  /** Stops a campaign before it is sent. Messages already handed to the provider cannot be called back. */
  async cancel(id: string): Promise<CampaignDto> {
    const campaign = await this.get(id);
    if (['sending', 'completed', 'cancelled'].includes(campaign.status)) {
      throw new ProblemException(409, 'CONFLICT', 'Cannot cancel', `The campaign is already ${campaign.status}.`);
    }
    const [row] = await this.db.current.update(messageCampaigns).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(messageCampaigns.id, id)).returning();
    await this.audit.record('update', 'message_campaigns', id, { status: [campaign.status, 'cancelled'] });
    return CampaignDto.from(row!);
  }

  async report(id: string): Promise<CampaignReportDto> {
    await this.get(id);
    const rows = await this.db.current
      .select({ status: messageCampaignRecipients.status, n: sql<number>`count(*)::int` })
      .from(messageCampaignRecipients)
      .where(eq(messageCampaignRecipients.campaignId, id))
      .groupBy(messageCampaignRecipients.status);
    const n = (...s: string[]) => rows.filter((r) => s.includes(r.status)).reduce((t, r) => t + r.n, 0);
    return {
      audience: n('pending', 'sent', 'delivered', 'failed', 'replied', 'opted_out', 'skipped_opted_out'),
      skippedOptedOut: n('skipped_opted_out'),
      sent: n('sent', 'delivered', 'replied', 'opted_out'),
      delivered: n('delivered', 'replied', 'opted_out'),
      failed: n('failed'),
      replied: n('replied'),
      optedOut: n('opted_out'),
    };
  }

  // ---------------------------------------------------------------- sending (worker)
  /** campaign-dispatch job: one queued message per recipient, sent by the send-message job. */
  async dispatch(campaignId: string): Promise<void> {
    const campaign = await this.get(campaignId).catch(() => undefined);
    if (!campaign || campaign.status !== 'approved') return;
    await this.db.current.update(messageCampaigns).set({ status: 'sending', startedAt: new Date(), updatedAt: new Date() }).where(eq(messageCampaigns.id, campaignId));
    const template = await this.templates.get(campaign.templateId);
    const pending = await this.db.current
      .select()
      .from(messageCampaignRecipients)
      .where(and(eq(messageCampaignRecipients.campaignId, campaignId), eq(messageCampaignRecipients.status, 'pending')));
    for (const r of pending) {
      const lead = await this.leads.findRow(r.leadId);
      if (!lead || lead.deletedAt || (await this.messaging.optedOut(r.leadId, campaign.channel))) {
        await this.setRecipient(campaignId, r.leadId, 'skipped_opted_out');
        continue;
      }
      const name = lead.fullName.trim();
      const rendered = this.templates.render(template, { first_name: name.split(/\s+/)[0] || name, full_name: name });
      const conversation = await this.messaging.conversationFor(r.leadId, campaign.channel, campaign.integrationId, r.address);
      const [message] = await this.db.current
        .insert(messages)
        .values({
          tenantId: campaign.tenantId,
          conversationId: conversation.id,
          leadId: r.leadId,
          direction: 'outbound',
          templateId: template.id,
          campaignId,
          subject: rendered.subject,
          body: rendered.body,
          status: 'queued',
        })
        .returning();
      await this.db.current
        .update(messageCampaignRecipients)
        .set({ messageId: message!.id, updatedAt: new Date() })
        .where(and(eq(messageCampaignRecipients.campaignId, campaignId), eq(messageCampaignRecipients.leadId, r.leadId)));
      await this.leads.addActivity(r.leadId, {
        type: campaign.channel,
        summary: `${campaign.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} campaign: ${campaign.name}`,
        body: rendered.body.slice(0, 1000),
        actorUserId: null,
        links: { messageId: message!.id },
      });
      await this.queue.send<SendJob>('send-message', { tenantId: campaign.tenantId, messageId: message!.id, params: rendered.params });
    }
    await this.finishIfDone(campaignId);
  }

  private async recipientResult(campaignId: string, leadId: string, status: 'sent' | 'failed'): Promise<void> {
    await this.setRecipient(campaignId, leadId, status);
    await this.finishIfDone(campaignId);
  }

  /** Delivery receipts, replies and opt-outs from the provider (WhatsApp / email webhooks). */
  async recipientUpdate(messageId: string, status: 'delivered' | 'replied' | 'opted_out'): Promise<void> {
    const order = ['pending', 'sent', 'delivered', 'replied', 'opted_out'];
    const [r] = await this.db.current.select().from(messageCampaignRecipients).where(eq(messageCampaignRecipients.messageId, messageId)).limit(1);
    if (r && order.indexOf(status) > order.indexOf(r.status)) await this.setRecipient(r.campaignId, r.leadId, status);
  }

  private async setRecipient(campaignId: string, leadId: string, status: (typeof messageCampaignRecipients.$inferSelect)['status']): Promise<void> {
    await this.db.current
      .update(messageCampaignRecipients)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(messageCampaignRecipients.campaignId, campaignId), eq(messageCampaignRecipients.leadId, leadId)));
  }

  /** Completed once no recipient waits for a send result. */
  private async finishIfDone(campaignId: string): Promise<void> {
    const [waiting] = await this.db.current
      .select({ n: sql<number>`count(*)::int` })
      .from(messageCampaignRecipients)
      .where(and(eq(messageCampaignRecipients.campaignId, campaignId), inArray(messageCampaignRecipients.status, ['pending'])));
    if (waiting!.n === 0) {
      await this.db.current
        .update(messageCampaigns)
        .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(messageCampaigns.id, campaignId), eq(messageCampaigns.status, 'sending')));
    }
  }

  // ---------------------------------------------------------------- helpers
  private async resolveAudience(p: Principal, campaign: CampaignRow): Promise<{ leadId: string; name: string; address: string; optedOut: boolean }[]> {
    const out: { leadId: string; name: string; address: string; optedOut: boolean }[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.leads.list(p, { ...(campaign.audienceFilter as Partial<LeadListQuery>), limit: PAGE, ...(cursor ? { cursor } : {}) } as LeadListQuery);
      for (const lead of page.data) {
        const address = campaign.channel === 'whatsapp' ? lead.phonePrimary : lead.email;
        if (!address || lead.deletedAt) continue;
        out.push({ leadId: lead.id, name: lead.fullName, address, optedOut: await this.messaging.optedOut(lead.id, campaign.channel) });
      }
      cursor = page.page.nextCursor ?? undefined;
    } while (cursor);
    return out;
  }

  private async checkTemplate(templateId: string, channel: 'whatsapp' | 'email'): Promise<TemplateRow> {
    const template = await this.templates.get(templateId).catch(() => {
      throw Problems.validation([{ field: 'templateId', message: 'template not found' }]);
    });
    const errors = [];
    if (template.channel !== channel) errors.push({ field: 'templateId', message: `this is a ${template.channel} template` });
    if (template.status !== 'approved') errors.push({ field: 'templateId', message: 'the template is not approved yet' });
    const extra = template.variables.map((v) => v.name).filter((n) => !LEAD_FIELDS.includes(n));
    if (extra.length) errors.push({ field: 'templateId', message: `campaign templates can only use {{first_name}} and {{full_name}} (found ${extra.map((n) => `{{${n}}}`).join(', ')})` });
    if (errors.length) throw Problems.validation(errors);
    return template;
  }

  private async senderFor(channel: 'whatsapp' | 'email', integrationId?: string): Promise<string> {
    if (integrationId) {
      const row = await this.integrations.get(integrationId).catch(() => undefined);
      const provider = channel === 'whatsapp' ? 'whatsapp_cloud' : 'email_ses';
      if (!row || row.provider !== provider || row.status !== 'connected') throw Problems.validation([{ field: 'integrationId', message: `not a connected ${channel} sender` }]);
      return row.id;
    }
    const sender = await this.integrations.connectedSender(channel === 'whatsapp' ? 'whatsapp_cloud' : 'email_ses');
    if (!sender) throw notConnected(channel);
    return sender.id;
  }
}

/** The audience filter uses the lead list filters; unknown or invalid keys are refused. */
async function checkAudience(filter: Record<string, unknown>): Promise<Record<string, unknown>> {
  const unknown = Object.keys(filter).filter((k) => !AUDIENCE_KEYS.includes(k));
  if (unknown.length) throw Problems.validation(unknown.map((k) => ({ field: `audienceFilter.${k}`, message: 'not a lead filter' })));
  const errors = await validate(plainToInstance(LeadListQuery, { ...filter, limit: PAGE }));
  if (errors.length) throw Problems.validation(errors.map((e) => ({ field: `audienceFilter.${e.property}`, message: Object.values(e.constraints ?? {})[0] ?? 'invalid' })));
  return filter;
}
