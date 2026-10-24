import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QueueService } from '../../../core/queue/queue.service';
import { IntakeInput, LeadIntakeService } from '../../leads/lead-intake.service';
import { MarketingService } from '../../marketing/marketing.service';
import { LeadConfigService } from '../../settings/lead-config.service';
import { IntegrationRow, Provider, WebhookEventRow } from '../integrations.schema';
import { IntegrationsService } from '../integrations.service';
import { META_API, MetaApi } from '../meta/meta-api';
import { FieldMapping, mapFields } from './field-mapping';
import { InboxJob, PermanentEventError, WebhookInbox } from './webhook-inbox';

/** Lead source used when the connection has none chosen (created on first use). */
const SOURCE_FOR: Partial<Record<Provider, { type: 'meta' | 'google_ads' | 'webhook' | 'website' | 'property_finder' | 'bayut' | 'dubizzle'; name: string; qualityScore: number }>> = {
  meta: { type: 'meta', name: 'Meta lead ads', qualityScore: 60 },
  google_ads: { type: 'google_ads', name: 'Google Ads lead forms', qualityScore: 60 },
  webhook: { type: 'webhook', name: 'General webhook', qualityScore: 50 },
  website: { type: 'website', name: 'Website', qualityScore: 60 },
  property_finder: { type: 'property_finder', name: 'Property Finder', qualityScore: 60 },
  bayut: { type: 'bayut', name: 'Bayut', qualityScore: 60 },
  dubizzle: { type: 'dubizzle', name: 'Dubizzle', qualityScore: 60 },
};

/** Webhook event provider for portal lead emails (SES → SNS); the event belongs to the portal's connection. */
export const EMAIL_EVENT_PROVIDER = 'ses_inbound';

/**
 * lead-intake job (architecture §4 steps 3–8) for every lead source: Meta (answers fetched from Meta), the general
 * webhook, portals and portal lead emails (answers mapped from the payload). Then the shared lead intake:
 * re-enquiry, assignment, score, notification, timer.
 */
@Injectable()
export class IncomingLeadIntake implements OnModuleInit {
  constructor(
    private readonly inbox: WebhookInbox,
    private readonly queue: QueueService,
    private readonly integrations: IntegrationsService,
    private readonly intake: LeadIntakeService,
    private readonly config: LeadConfigService,
    private readonly marketing: MarketingService,
    @Inject(META_API) private readonly meta: MetaApi,
  ) {}

  onModuleInit(): void {
    this.queue.register<InboxJob>('lead-intake', (job) => this.process(job.webhookEventId));
  }

  process(eventId: string): Promise<void> {
    return this.inbox.process('lead-intake', eventId, async (event, integration) => {
      const input = event.provider === 'meta' ? await this.fromMeta(event, integration) : await this.fromPayload(event, integration);
      const result = await this.intake.receive(input);
      if (result.status === 'rejected') throw new PermanentEventError(`Not imported: ${result.errors.join('; ')}`);
    });
  }

  private async fromMeta(event: WebhookEventRow, integration: IntegrationRow): Promise<IntakeInput> {
    const token = await this.integrations.pageToken(integration);
    if (!token) throw new Error('Access token missing; connect Meta again');
    const lead = await this.meta.fetchLead(event.externalEventId, token);
    const answers = Object.fromEntries(lead.fieldData.map((f) => [f.name, f.values.join(', ')]));
    const pick = (...names: string[]) => names.map((n) => answers[n]).find((v) => v);
    const sourceId = await this.sourceFor(integration);
    const campaignId = lead.campaignId ? await this.marketing.findOrCreateExternal(sourceId, lead.campaignId, lead.campaignName ?? `Meta campaign ${lead.campaignId}`) : null;
    const name = pick('full_name') ?? ([pick('first_name'), pick('last_name')].filter(Boolean).join(' ') || null);
    return {
      sourceId,
      fullName: name,
      phone: pick('phone_number', 'phone'),
      email: pick('email'),
      campaignId,
      integrationId: integration.id,
      externalCampaignId: lead.campaignId ?? null,
      externalAdsetId: lead.adsetId ?? null,
      externalAdId: lead.adId ?? null,
      externalFormId: lead.formId ?? null,
      externalSubmissionId: lead.id,
      formName: lead.formName ?? null,
      formAnswers: answers,
      rawPayload: lead,
      submittedAt: lead.createdTime,
    };
  }

  /** General webhook, portals, portal lead emails and Google Ads: the connection's field mapping, then common names. */
  private async fromPayload(event: WebhookEventRow, integration: IntegrationRow): Promise<IntakeInput> {
    const fields = event.provider === EMAIL_EVENT_PROVIDER ? ((event.payload.fields as Record<string, unknown>) ?? {}) : event.payload;
    const m = mapFields(fields, (integration.settings.fieldMapping as FieldMapping | undefined) ?? {});
    return {
      sourceId: await this.sourceFor(integration),
      fullName: m.fullName,
      phone: m.phone,
      phoneAlternate: m.phoneAlternate,
      email: m.email,
      preferredLanguage: m.preferredLanguage,
      countryCode: m.countryCode,
      city: m.city,
      budgetMin: m.budgetMin,
      budgetMax: m.budgetMax,
      budgetCurrency: m.budgetCurrency,
      integrationId: integration.id,
      externalCampaignId: m.externalCampaignId,
      externalSubmissionId: m.externalId,
      formName: m.formName,
      formAnswers: m.answers,
      rawPayload: event.payload,
      submittedAt: event.receivedAt,
      note: m.note,
    };
  }

  /** The source chosen on the connection, else the tenant's source of that type (created on first use). */
  private async sourceFor(integration: IntegrationRow): Promise<string> {
    if (typeof integration.settings.sourceId === 'string') return integration.settings.sourceId;
    const def = SOURCE_FOR[integration.provider];
    if (!def) throw new PermanentEventError(`No lead source for ${integration.provider}`);
    const existing = await this.config.sourceByType(def.type);
    if (existing) return existing.id;
    return (await this.config.createSource({ type: def.type, name: def.name, qualityScore: def.qualityScore })).id;
  }
}
