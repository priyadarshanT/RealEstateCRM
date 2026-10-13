import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { isStillReferenced, pgCode, PG_UNIQUE_VIOLATION } from '../../core/errors/pg';
import { ProblemException, Problems } from '../../core/errors/problem';
import { decodeCursor, Page, toPage } from '../../core/http/pagination';
import { IntegrationsService } from '../integrations/integrations.service';
import { CHANNEL_GATEWAY, ChannelGateway } from './adapters/channel-gateway';
import { TemplateDto, TemplateInputDto, TemplateListQuery } from './dto/messaging.dto';
import { messageTemplates, TemplateRow } from './messaging.schema';

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

export interface RenderedTemplate {
  subject: string | null;
  body: string;
  /** Values in the order the placeholders first appear: WhatsApp's {{1}}, {{2}}… */
  params: string[];
}

/**
 * Message templates (SRS §5.2): brochures, follow-ups, meeting confirmations. Bodies use named placeholders such as
 * {{first_name}}. WhatsApp templates go to Meta for approval before use; email templates are usable once submitted.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
    @Inject(CHANNEL_GATEWAY) private readonly gateway: ChannelGateway,
  ) {}

  async list(q: TemplateListQuery): Promise<Page<TemplateDto>> {
    const where = [q.channel ? eq(messageTemplates.channel, q.channel) : undefined, q.status ? eq(messageTemplates.status, q.status) : undefined];
    if (q.cursor) {
      const [name, id] = decodeCursor(q.cursor, 2) as [string, string];
      where.push(sql`(${messageTemplates.name}, ${messageTemplates.id}) > (${name}, ${id}::uuid)`);
    }
    const rows = await this.db.current
      .select()
      .from(messageTemplates)
      .where(and(...where))
      .orderBy(asc(messageTemplates.name), asc(messageTemplates.id))
      .limit(q.limit + 1);
    return toPage(rows, q.limit, (t) => [t.name, t.id], TemplateDto.from);
  }

  async get(id: string): Promise<TemplateRow> {
    const [row] = await this.db.current.select().from(messageTemplates).where(eq(messageTemplates.id, id)).limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }

  async create(p: Principal, body: TemplateInputDto): Promise<TemplateDto> {
    const missing = (['channel', 'name', 'category', 'body'] as const).filter((k) => !body[k]).map((field) => ({ field, message: 'required' }));
    if (missing.length) throw Problems.validation(missing);
    const values = {
      channel: body.channel!,
      name: body.name!,
      language: body.language ?? 'en',
      category: body.category!,
      subject: body.subject ?? null,
      body: body.body!,
      variables: (body.variables ?? []).map((v) => ({ name: v.name, ...(v.example ? { example: v.example } : {}) })),
    };
    checkTemplate(values);
    const [row] = await this.unique(() => this.db.current.insert(messageTemplates).values({ tenantId: p.tenantId, createdBy: p.userId, ...values }).returning());
    await this.audit.record('create', 'message_templates', row!.id, { name: [null, row!.name], channel: [null, row!.channel] });
    return TemplateDto.from(row!);
  }

  /** WhatsApp templates already sent to Meta (pending or approved) cannot change; create a new one instead. */
  async update(id: string, body: TemplateInputDto): Promise<TemplateDto> {
    const before = await this.get(id);
    if (before.channel === 'whatsapp' && (before.status === 'pending' || before.status === 'approved')) {
      throw new ProblemException(409, 'TEMPLATE_LOCKED', 'Template already submitted', 'WhatsApp templates sent to Meta cannot be changed. Create a new template instead.');
    }
    if (body.channel && body.channel !== before.channel) throw Problems.validation([{ field: 'channel', message: 'the channel of a template cannot change' }]);
    const next = {
      name: body.name ?? before.name,
      language: body.language ?? before.language,
      category: body.category ?? before.category,
      subject: body.subject === undefined ? before.subject : body.subject,
      body: body.body ?? before.body,
      variables: body.variables ? body.variables.map((v) => ({ name: v.name, ...(v.example ? { example: v.example } : {}) })) : before.variables,
    };
    checkTemplate({ channel: before.channel, ...next });
    // A changed email template goes back to draft until it is submitted again.
    const [row] = await this.unique(() =>
      this.db.current
        .update(messageTemplates)
        .set({ ...next, status: before.status === 'approved' ? 'draft' : before.status, updatedAt: new Date() })
        .where(eq(messageTemplates.id, id))
        .returning(),
    );
    await this.audit.record('update', 'message_templates', id, { body: [before.body, row!.body], subject: [before.subject, row!.subject] });
    return TemplateDto.from(row!);
  }

  async remove(id: string): Promise<void> {
    const row = await this.get(id);
    try {
      await this.db.current.delete(messageTemplates).where(eq(messageTemplates.id, id));
    } catch (err) {
      if (isStillReferenced(err)) {
        throw new ProblemException(409, 'TEMPLATE_IN_USE', 'Template in use', 'This template was used by messages or campaigns. Disable it by not using it, or create a new one.');
      }
      throw err;
    }
    await this.audit.record('delete', 'message_templates', id, { name: [row.name, null] });
  }

  /** Sends a WhatsApp template to Meta for approval (status pending until Meta answers by webhook). */
  async submit(id: string): Promise<TemplateDto> {
    const before = await this.get(id);
    if (before.status === 'pending' || before.status === 'approved') return TemplateDto.from(before);
    let providerTemplateId: string | null = null;
    let status: 'pending' | 'approved' = 'approved';
    let integrationId: string | null = null;
    if (before.channel === 'whatsapp') {
      const sender = await this.integrations.connectedSender('whatsapp_cloud');
      if (!sender) throw notConnected('whatsapp');
      const result = await this.gateway.submitTemplate(
        { provider: 'whatsapp_cloud', settings: sender.settings, credentials: await this.integrations.credentials(sender) },
        { name: before.name, language: before.language, category: before.category, body: toPositional(before.body) },
      );
      providerTemplateId = result.providerTemplateId;
      status = result.status;
      integrationId = sender.id;
    }
    const [row] = await this.db.current
      .update(messageTemplates)
      .set({ status, providerTemplateId, integrationId, updatedAt: new Date() })
      .where(eq(messageTemplates.id, id))
      .returning();
    await this.audit.record('update', 'message_templates', id, { status: [before.status, status] });
    return TemplateDto.from(row!);
  }

  /** Meta's review result (template status webhook). */
  async setReviewResult(providerTemplateId: string, status: 'approved' | 'rejected' | 'disabled'): Promise<void> {
    await this.db.current.update(messageTemplates).set({ status, updatedAt: new Date() }).where(eq(messageTemplates.providerTemplateId, providerTemplateId));
  }

  /** Fills the placeholders. Every placeholder needs a value; examples are not used as values. */
  render(t: TemplateRow, values: Record<string, string> = {}): RenderedTemplate {
    const names = placeholders(t.body);
    const missing = [...new Set([...names, ...placeholders(t.subject ?? '')])].filter((n) => !values[n]?.trim());
    if (missing.length) throw Problems.validation(missing.map((n) => ({ field: `variables.${n}`, message: 'a value is required' })));
    const fill = (text: string) => text.replace(PLACEHOLDER, (_m, n: string) => values[n]!.trim());
    return { subject: t.subject ? fill(t.subject) : null, body: fill(t.body), params: names.map((n) => values[n]!.trim()) };
  }

  private async unique<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) {
        throw new ProblemException(409, 'TEMPLATE_EXISTS', 'Template already exists', 'A template with this name and language already exists for this channel.');
      }
      throw err;
    }
  }
}

export function notConnected(channel: 'whatsapp' | 'email'): ProblemException {
  return channel === 'whatsapp'
    ? new ProblemException(422, 'INTEGRATION_NOT_CONFIGURED', 'WhatsApp is not connected', 'Connect your WhatsApp Business number in Settings → Connections first.')
    : new ProblemException(422, 'INTEGRATION_NOT_CONFIGURED', 'Email is not connected', 'Connect your company email sender in Settings → Connections first.');
}

/** Placeholder names in order of first appearance. */
function placeholders(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) if (!seen.includes(m[1]!)) seen.push(m[1]!);
  return seen;
}

/** WhatsApp templates use numbered placeholders: {{first_name}} … → {{1}} … in order of appearance. */
function toPositional(body: string): string {
  const order = placeholders(body);
  return body.replace(PLACEHOLDER, (_m, n: string) => `{{${order.indexOf(n) + 1}}}`);
}

function checkTemplate(t: { channel: string; subject: string | null; body: string; variables: { name: string }[] }): void {
  const errors = [];
  if (t.channel === 'email' && !t.subject?.trim()) errors.push({ field: 'subject', message: 'email templates need a subject' });
  const declared = new Set(t.variables.map((v) => v.name));
  for (const n of [...placeholders(t.body), ...placeholders(t.subject ?? '')]) {
    if (!declared.has(n)) errors.push({ field: 'variables', message: `{{${n}}} is used but not listed in variables` });
  }
  if (errors.length) throw Problems.validation(errors);
}
