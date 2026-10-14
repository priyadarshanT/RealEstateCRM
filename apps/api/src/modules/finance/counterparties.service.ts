import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { DbService } from '../../core/database/db.service';
import { pgCode, PG_CHECK_VIOLATION, PG_FOREIGN_KEY_VIOLATION } from '../../core/errors/pg';
import { Problems } from '../../core/errors/problem';
import { versionConflict } from '../../core/http/etag';
import { decodeCursor, Page, toPage } from '../../core/http/pagination';
import { normalizePhone } from '../leads/lead-intake.service';
import { LeadsService } from '../leads/leads.service';
import { ProjectsService } from '../projects/projects.service';
import { CounterpartyDto, CounterpartyInputDto, CounterpartyListQuery } from './dto/finance.dto';
import { counterparties, CounterpartyRow } from './finance.schema';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Who a financial document is with (SRS §7.1): a client (optionally the lead), a developer (linked to the developer
 * record) or a vendor. A client or developer counterparty can be prefilled from the lead or developer.
 */
@Injectable()
export class CounterpartiesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly leads: LeadsService,
    private readonly projects: ProjectsService,
  ) {}

  async list(q: CounterpartyListQuery): Promise<Page<CounterpartyDto>> {
    const after = q.cursor ? (([name, id]) => sql`(${counterparties.name}, ${counterparties.id}) > (${name}, ${id}::uuid)`)(decodeCursor(q.cursor, 2) as [string, string]) : undefined;
    const rows = await this.db.current
      .select()
      .from(counterparties)
      .where(and(after, q.type ? eq(counterparties.type, q.type) : undefined, q.q ? ilike(counterparties.name, `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined))
      .orderBy(asc(counterparties.name), asc(counterparties.id))
      .limit(q.limit + 1);
    return toPage(rows, q.limit, (r) => [r.name, r.id], CounterpartyDto.from);
  }

  async get(id: string): Promise<CounterpartyRow> {
    const [row] = await this.db.current.select().from(counterparties).where(eq(counterparties.id, id)).limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }

  async create(body: CounterpartyInputDto): Promise<CounterpartyRow> {
    if (!body.type) throw Problems.validation([{ field: 'type', message: 'type is required' }]);
    const prefill = await this.prefill(body.type, body.leadId ?? null, body.developerId ?? null);
    const name = body.name?.trim() || prefill.name;
    if (!name) throw Problems.validation([{ field: 'name', message: 'name is required' }]);
    const [row] = await this.db.current
      .insert(counterparties)
      .values({
        tenantId: this.db.currentTenantId!,
        type: body.type,
        name,
        leadId: body.type === 'client' ? (body.leadId ?? null) : null,
        developerId: body.type === 'developer' ? (body.developerId ?? null) : null,
        ...fields({ ...prefill, ...definedOnly(body) }),
      })
      .returning()
      .catch(rethrow);
    await this.audit.record('create', 'counterparties', row!.id, { type: [null, row!.type], name: [null, row!.name] });
    return row!;
  }

  async update(id: string, body: CounterpartyInputDto, expectedVersion?: string): Promise<CounterpartyRow> {
    const before = await this.get(id);
    if (body.type && body.type !== before.type) throw Problems.validation([{ field: 'type', message: 'the type cannot change' }]);
    if (body.leadId !== undefined && body.leadId !== null) await this.prefill(before.type, body.leadId, null);
    if (body.developerId !== undefined && body.developerId !== null) await this.prefill(before.type, null, body.developerId);
    const [after] = await this.db.current
      .update(counterparties)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.leadId !== undefined && before.type === 'client' ? { leadId: body.leadId } : {}),
        ...(body.developerId ? { developerId: body.developerId } : {}),
        ...fields(definedOnly(body)),
      })
      .where(and(eq(counterparties.id, id), expectedVersion ? eq(counterparties.updatedAt, expectedVersion) : undefined))
      .returning()
      .catch(rethrow);
    if (!after) throw versionConflict();
    await this.audit.recordUpdate('counterparties', id, view(before), view(after));
    return after;
  }

  /** Name, email, phone and TRN from the linked lead or developer; checks the link exists. */
  private async prefill(type: CounterpartyRow['type'], leadId: string | null, developerId: string | null) {
    if (type === 'developer') {
      if (!developerId) throw Problems.validation([{ field: 'developerId', message: 'choose the developer' }]);
      const d = await this.projects.getDeveloper(developerId).catch(() => {
        throw Problems.validation([{ field: 'developerId', message: 'developer not found' }]);
      });
      return { name: d.name, trn: d.trn, email: d.email, phone: d.phone, address: d.address };
    }
    if (developerId) throw Problems.validation([{ field: 'developerId', message: 'only for developer counterparties' }]);
    if (type === 'vendor' && leadId) throw Problems.validation([{ field: 'leadId', message: 'only for client counterparties' }]);
    if (type === 'client' && leadId) {
      const lead = await this.leads.findRow(leadId);
      if (!lead || lead.deletedAt) throw Problems.validation([{ field: 'leadId', message: 'lead not found' }]);
      return { name: lead.fullName, email: lead.email, phone: lead.phonePrimary };
    }
    return { name: undefined };
  }
}

function definedOnly(body: CounterpartyInputDto) {
  return Object.fromEntries((['trn', 'email', 'phone', 'address'] as const).filter((k) => body[k] !== undefined).map((k) => [k, body[k]])) as Partial<Record<'trn' | 'email' | 'phone' | 'address', string | null>>;
}

function fields(input: { trn?: string | null; email?: string | null; phone?: string | null; address?: string | null }) {
  const errors: { field: string; message: string }[] = [];
  const email = input.email ? input.email.trim().toLowerCase() : input.email;
  if (email && !EMAIL.test(email)) errors.push({ field: 'email', message: 'not a valid email' });
  const phone = input.phone ? normalizePhone(input.phone) : input.phone;
  if (input.phone && !phone) errors.push({ field: 'phone', message: 'use the international format, e.g. +971 50 123 4567' });
  if (errors.length) throw Problems.validation(errors);
  return {
    ...(input.trn !== undefined ? { trn: input.trn } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(input.address !== undefined ? { address: input.address } : {}),
  };
}

function view(c: CounterpartyRow) {
  return { name: c.name, trn: c.trn, email: c.email, phone: c.phone, address: c.address, leadId: c.leadId, developerId: c.developerId };
}

function rethrow(err: unknown): never {
  if (pgCode(err) === PG_FOREIGN_KEY_VIOLATION || pgCode(err) === PG_CHECK_VIOLATION) throw Problems.validation([{ field: 'type', message: 'the lead or developer link does not fit this type' }]);
  throw err;
}
