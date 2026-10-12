import { Injectable } from '@nestjs/common';
import { AuditService } from '../../core/audit/audit.service';
import { EventBus } from '../../core/events/domain-events';
import { OrganizationDirectory } from '../organization/directory.service';
import { LeadConfigService } from '../settings/lead-config.service';
import { LeadActionsService } from './lead-actions.service';
import { LeadsRepository } from './leads.repository';
import { LeadRow } from './leads.schema';
import { LeadsService } from './leads.service';

/** One enquiry from any source: Meta, portals, the general webhook, an import row, the booking page (SRS §2.1–2.8). */
export interface IntakeInput {
  sourceId: string;
  fullName?: string | null;
  phone?: string | null;
  phoneAlternate?: string | null;
  email?: string | null;
  countryCode?: string | null;
  preferredLanguage?: string | null;
  budgetMin?: string | null;
  budgetMax?: string | null;
  budgetCurrency?: string | null;
  campaignId?: string | null;
  eventId?: string | null;
  integrationId?: string | null;
  projectId?: string | null;
  externalCampaignId?: string | null;
  externalAdsetId?: string | null;
  externalAdId?: string | null;
  externalFormId?: string | null;
  externalSubmissionId?: string | null;
  formName?: string | null;
  formAnswers?: Record<string, unknown>;
  rawPayload?: unknown;
  submittedAt?: Date;
  note?: string | null;
}

export type IntakeResult =
  | { status: 'created'; leadId: string }
  | { status: 're_enquired'; leadId: string; reopened: boolean }
  | { status: 'duplicate'; leadId?: string }
  | { status: 'rejected'; errors: string[] };

/**
 * Lead intake: the same submission is never imported twice; a known phone or email becomes a re-enquiry on the
 * existing lead (same agent, "Re-enquired" notification, Lost/Invalid reopens in Follow-up); otherwise a new lead
 * is created and the assignment rules choose its owner.
 */
@Injectable()
export class LeadIntakeService {
  constructor(
    private readonly leads: LeadsService,
    private readonly actions: LeadActionsService,
    private readonly repo: LeadsRepository,
    private readonly config: LeadConfigService,
    private readonly directory: OrganizationDirectory,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  async receive(input: IntakeInput): Promise<IntakeResult> {
    const phone = normalizePhone(input.phone);
    const phoneAlternate = normalizePhone(input.phoneAlternate);
    const email = normalizeEmail(input.email);
    const errors: string[] = [];
    if (input.phone && !phone) errors.push(`phone "${input.phone}" is not a valid international number`);
    if (input.email && !email) errors.push(`email "${input.email}" is not valid`);
    if (!phone && !email) errors.push('a phone or an email is required');
    if (errors.length) return { status: 'rejected', errors };

    if (input.externalSubmissionId && (await this.repo.submissionExists(input.sourceId, input.externalSubmissionId))) {
      return { status: 'duplicate' };
    }
    const source = await this.config.getSource(input.sourceId);
    const phones = [phone, phoneAlternate].filter((v): v is string => Boolean(v));
    const existing = await this.repo.findExisting(phones, email);
    const submittedAt = input.submittedAt ?? new Date();
    const inquiryBase = {
      sourceId: input.sourceId,
      campaignId: input.campaignId ?? null,
      eventId: input.eventId ?? null,
      integrationId: input.integrationId ?? null,
      projectId: input.projectId ?? null,
      externalCampaignId: input.externalCampaignId ?? null,
      externalAdsetId: input.externalAdsetId ?? null,
      externalAdId: input.externalAdId ?? null,
      externalFormId: input.externalFormId ?? null,
      externalSubmissionId: input.externalSubmissionId ?? null,
      formName: input.formName ?? null,
      formAnswers: input.formAnswers ?? {},
      rawPayload: input.rawPayload ?? null,
      submittedAt,
    };

    if (existing) return this.reEnquire(existing, inquiryBase, source.name, input.projectId ?? null);

    const stage = await this.leads.stageByKey('new');
    const lead = await this.repo.insert({
      fullName: input.fullName?.trim() || email || phone!,
      phonePrimary: phone ?? null,
      phoneAlternate: phoneAlternate && phoneAlternate !== phone ? phoneAlternate : null,
      email,
      countryCode: input.countryCode ?? null,
      preferredLanguage: input.preferredLanguage ?? null,
      budgetMin: input.budgetMin ?? null,
      budgetMax: input.budgetMax ?? null,
      budgetCurrency: input.budgetMin || input.budgetMax ? (input.budgetCurrency ?? null) : null,
      sourceId: input.sourceId,
      campaignId: input.campaignId ?? null,
      eventId: input.eventId ?? null,
      formName: input.formName ?? null,
      stageId: stage.id,
      stageCategory: stage.category,
      latestNote: input.note ?? null,
      lastEnquiryAt: submittedAt,
    });
    const inquiry = await this.repo.insertInquiry({ ...inquiryBase, leadId: lead.id });
    await this.repo.addActivity(lead.id, { type: 'inquiry', summary: `Enquiry via ${source.name}${input.formName ? ` (${input.formName})` : ''}`, occurredAt: submittedAt, links: { inquiryId: inquiry.id } });
    await this.repo.insertStageHistory({ leadId: lead.id, fromStageId: null, toStageId: stage.id, isAutomatic: true });
    if (input.projectId) await this.repo.addProject(lead.id, input.projectId);
    if (input.note) await this.repo.addActivity(lead.id, { type: 'note', summary: 'Note added', body: input.note });
    await this.audit.record('create', 'leads', lead.id, { fullName: [null, lead.fullName], sourceId: [null, lead.sourceId] });
    await this.events.publish('lead.created', { tenantId: lead.tenantId, leadId: lead.id, ownerUserId: null, sourceId: lead.sourceId, viaIntake: true });
    return { status: 'created', leadId: lead.id };
  }

  private async reEnquire(
    lead: LeadRow,
    inquiryBase: Omit<Parameters<LeadsRepository['insertInquiry']>[0], 'leadId'>,
    sourceName: string,
    projectId: string | null,
  ): Promise<IntakeResult> {
    const inquiry = await this.repo.insertInquiry({ ...inquiryBase, leadId: lead.id, isReEnquiry: true });
    await this.repo.update(lead.id, {
      enquiryCount: lead.enquiryCount + 1,
      lastEnquiryAt: inquiryBase.submittedAt ?? new Date(),
      lastInboundAt: new Date(),
      ...(inquiryBase.formName ? { formName: inquiryBase.formName } : {}),
    });
    await this.repo.addActivity(lead.id, { type: 're_enquiry', summary: `Re-enquired via ${sourceName}`, links: { inquiryId: inquiry.id } });
    if (projectId) await this.repo.addProject(lead.id, projectId);

    // Lost or Invalid → back to Follow-up with the same agent (SRS §2.7).
    let reopened = false;
    if (lead.stageCategory === 'lost' || lead.stageCategory === 'invalid') {
      const followUp = await this.leads.stageByKey('follow_up');
      await this.actions.applyStage(lead, { stageId: followUp.id, note: `Reopened: re-enquired via ${sourceName}`, nextFollowUpAt: new Date().toISOString() }, null, true);
      reopened = true;
    }

    // The previous agent keeps the lead unless they were deactivated or stopped receiving leads (SRS §2.8).
    const owner = lead.ownerUserId ? await this.directory.user(lead.ownerUserId) : undefined;
    const ownerAvailable = owner && owner.status === 'active' && owner.receivesLeads;
    if (!ownerAvailable && lead.stageCategory !== 'won') {
      await this.events.publish('lead.needs_owner', {
        tenantId: lead.tenantId,
        leadId: lead.id,
        excludeUserIds: lead.ownerUserId ? [lead.ownerUserId] : [],
        method: 're_enquiry',
      });
    }
    await this.events.publish('lead.re_enquired', {
      tenantId: lead.tenantId,
      leadId: lead.id,
      ownerUserId: ownerAvailable ? lead.ownerUserId : null,
      sourceName,
      reopened,
    });
    return { status: 're_enquired', leadId: lead.id, reopened };
  }
}

/** Phone to E.164 (architecture §4 step 4). Accepts "+971 50 123 4567", "00971501234567"; no guessing of local numbers. */
export function normalizePhone(value?: string | null): string | null {
  if (!value) return null;
  let digits = value.trim().replace(/[\s().-]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  return /^\+[1-9][0-9]{6,14}$/.test(digits) ? digits : null;
}

export function normalizeEmail(value?: string | null): string | null {
  if (!value) return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
