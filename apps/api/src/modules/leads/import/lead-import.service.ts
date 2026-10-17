import { Injectable, OnModuleInit } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional } from 'class-validator';
import { desc, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { integer, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { AuditService } from '../../../core/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import { DbService } from '../../../core/database/db.service';
import { ProblemException, Problems } from '../../../core/errors/problem';
import { FilesService } from '../../../core/files/files.service';
import { IsUuid } from '../../../core/http/validators';
import { TenantJob, QueueService } from '../../../core/queue/queue.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { OrganizationDirectory } from '../../organization/directory.service';
import { ProjectsService } from '../../projects/projects.service';
import { LeadConfigService } from '../../settings/lead-config.service';
import { IntakeInput, LeadIntakeService, normalizeEmail, normalizePhone } from '../lead-intake.service';
import { readSheet, Sheet } from './spreadsheet';

// lead_imports (migration 0004)
export const leadImports = pgTable('lead_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  fileId: uuid('file_id').notNull(),
  sourceId: uuid('source_id').notNull(),
  mapping: jsonb('mapping').$type<Record<string, string>>().notNull().default({}),
  status: text('status').$type<'previewing' | 'importing' | 'completed' | 'failed'>().notNull().default('previewing'),
  preview: jsonb('preview').$type<PreviewRow[]>().notNull().default([]),
  rowsTotal: integer('rows_total').notNull().default(0),
  rowsImported: integer('rows_imported').notNull().default(0),
  rowsReEnquired: integer('rows_re_enquired').notNull().default(0),
  rowsRejected: integer('rows_rejected').notNull().default(0),
  rejectedRowsFileId: uuid('rejected_rows_file_id'),
  errorDetail: text('error_detail'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  duplicateMode: text('duplicate_mode').$type<DuplicateMode>().notNull().default('re_enquiry'),
  rowsUpdated: integer('rows_updated').notNull().default(0),
  rowsSkipped: integer('rows_skipped').notNull().default(0),
  attempts: smallint('attempts').notNull().default(1),
});
/** A known phone or email: re-enquiry (lead import), skip or update (Global Configuration › Migration). */
export const DUPLICATE_MODES = ['re_enquiry', 'skip', 'update'] as const;
export type DuplicateMode = (typeof DUPLICATE_MODES)[number];
type ImportRow = typeof leadImports.$inferSelect;

/** CRM fields a column can be mapped to. */
export const IMPORT_FIELDS = [
  'fullName',
  'phone',
  'phoneAlternate',
  'email',
  'countryCode',
  'city',
  'preferredLanguage',
  'budgetMin',
  'budgetMax',
  'budgetCurrency',
  'formName',
  'note',
  'submittedAt',
  'externalSubmissionId',
  'source',
  'owner',
  'status',
  'substatus',
  'project',
  'createdDate',
] as const;
type ImportField = (typeof IMPORT_FIELDS)[number];

/** Header names recognised automatically when no mapping is sent. */
const HEADER_GUESSES: Record<ImportField, string[]> = {
  fullName: ['name', 'full name', 'fullname', 'client name', 'customer name', 'lead name'],
  phone: ['phone', 'mobile', 'phone number', 'mobile number', 'contact number', 'whatsapp'],
  phoneAlternate: ['alternate phone', 'phone 2', 'second phone', 'other phone'],
  email: ['email', 'e-mail', 'email address'],
  countryCode: ['country', 'country code', 'nationality'],
  city: ['city', 'city name', 'town'],
  preferredLanguage: ['language', 'preferred language'],
  budgetMin: ['budget min', 'min budget', 'budget from'],
  budgetMax: ['budget', 'budget max', 'max budget', 'budget to'],
  budgetCurrency: ['currency', 'budget currency'],
  formName: ['form', 'form name'],
  note: ['note', 'notes', 'comment', 'comments', 'remarks'],
  submittedAt: ['date', 'created', 'submitted at', 'enquiry date'],
  externalSubmissionId: ['id', 'lead id', 'submission id', 'row id'],
  source: ['source', 'lead source'],
  owner: ['owner', 'assigned to', 'agent', 'agent email', 'owner email'],
  status: ['status', 'lead status', 'stage'],
  substatus: ['substatus', 'sub status', 'sub-status'],
  project: ['project', 'project name'],
  createdDate: ['created date', 'created on', 'lead created'],
};

/** Columns of the migration template (Global Configuration › Migration), in this order. */
const TEMPLATE: { header: string; example: string; field: ImportField }[] = [
  { header: 'Name', example: 'Rajesh Gupta', field: 'fullName' },
  { header: 'Country Code', example: 'IN', field: 'countryCode' },
  { header: 'City', example: 'Dubai', field: 'city' },
  { header: 'Phone', example: '+971501234567', field: 'phone' },
  { header: 'Email', example: 'rajesh@example.com', field: 'email' },
  { header: 'Source', example: 'Property Finder', field: 'source' },
  { header: 'Owner', example: 'agent@yourcompany.ae', field: 'owner' },
  { header: 'Status', example: 'Hot', field: 'status' },
  { header: 'Substatus', example: 'Zoom Schedule', field: 'substatus' },
  { header: 'Project', example: 'Marina Vista', field: 'project' },
  { header: 'Budget Min', example: '1500000', field: 'budgetMin' },
  { header: 'Budget Max', example: '2500000', field: 'budgetMax' },
  { header: 'Currency', example: 'AED', field: 'budgetCurrency' },
  { header: 'Notes', example: 'Wants 2BR with sea view', field: 'note' },
  { header: 'Created Date', example: '2026-01-15', field: 'createdDate' },
];

export interface PreviewRow {
  row: number;
  values: Record<string, string>;
  status: 'ok' | 'rejected';
  errors: string[];
}

const PREVIEW_ROWS = 20;

export class StartImportDto {
  @ApiProperty({ format: 'uuid' }) @IsUuid() fileId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUuid() sourceId!: string;
  @ApiPropertyOptional({ type: Object, description: 'CRM field → column header' }) @IsOptional() @IsObject() mapping?: Record<string, string>;
  @ApiPropertyOptional({ enum: DUPLICATE_MODES, description: 'Known phone or email: re_enquiry (default), skip or update' })
  @IsOptional()
  @IsIn(DUPLICATE_MODES)
  duplicateMode?: DuplicateMode;
}

export class LeadImportDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) fileId!: string;
  @ApiPropertyOptional({ type: Object }) mapping!: Record<string, string>;
  @ApiPropertyOptional({ format: 'uuid' }) sourceId!: string;
  @ApiProperty({ enum: ['previewing', 'importing', 'completed', 'failed'] }) status!: ImportRow['status'];
  @ApiPropertyOptional({ type: [Object] }) preview!: PreviewRow[];
  @ApiPropertyOptional() rowsTotal!: number;
  @ApiPropertyOptional() rowsImported!: number;
  @ApiPropertyOptional() rowsReEnquired!: number;
  @ApiPropertyOptional() rowsRejected!: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) rejectedRowsFileId!: string | null;
  @ApiPropertyOptional({ enum: DUPLICATE_MODES }) duplicateMode!: DuplicateMode;
  @ApiPropertyOptional() rowsUpdated!: number;
  @ApiPropertyOptional() rowsSkipped!: number;
  @ApiPropertyOptional({ description: 'Runs of this batch; a retry never creates duplicates' }) attempts!: number;
  @ApiPropertyOptional({ description: 'Short batch ID shown to users' }) batchId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) errorDetail!: string | null;
  @ApiPropertyOptional({ format: 'date-time' }) createdAt!: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) completedAt!: string | null;

  static from(i: ImportRow): LeadImportDto {
    return {
      id: i.id,
      fileId: i.fileId,
      mapping: i.mapping,
      sourceId: i.sourceId,
      status: i.status,
      preview: i.preview,
      rowsTotal: i.rowsTotal,
      rowsImported: i.rowsImported,
      rowsReEnquired: i.rowsReEnquired,
      rowsRejected: i.rowsRejected,
      rejectedRowsFileId: i.rejectedRowsFileId,
      duplicateMode: i.duplicateMode,
      rowsUpdated: i.rowsUpdated,
      rowsSkipped: i.rowsSkipped,
      attempts: i.attempts,
      batchId: `B-${i.id.slice(0, 8).toUpperCase()}`,
      errorDetail: i.errorDetail,
      createdAt: i.createdAt.toISOString(),
      completedAt: i.completedAt?.toISOString() ?? null,
    };
  }
}

export class LeadImportList {
  @ApiProperty({ type: [LeadImportDto] }) data!: LeadImportDto[];
}

/** Names in the file → IDs, looked up once per batch. */
interface Lookups {
  sources: Map<string, string>;
  users: Map<string, string>;
  stages: Map<string, { id: string; category: string; name: string }>;
  substatuses: Map<string, string>;
  projects: Map<string, string>;
}

interface ImportJob extends TenantJob {
  importId: string;
}

/**
 * Excel / CSV import (SRS §2.4): preview with phone and email checks, then a background import through the same
 * intake as every other source (re-enquiries, no double import); rejected rows come back as a file with the reason.
 */
@Injectable()
export class LeadImportService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly files: FilesService,
    private readonly intake: LeadIntakeService,
    private readonly config: LeadConfigService,
    private readonly queue: QueueService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly directory: OrganizationDirectory,
    private readonly projects: ProjectsService,
  ) {}

  onModuleInit(): void {
    this.queue.register<ImportJob>('lead-import', (job) => this.run(job.importId));
  }

  async start(p: Principal, body: StartImportDto): Promise<LeadImportDto> {
    const source = await this.config.getSource(body.sourceId).catch(() => undefined);
    if (!source || !source.isActive) throw Problems.validation([{ field: 'sourceId', message: 'unknown or inactive lead source' }]);
    const sheet = await this.sheet(body.fileId);
    const mapping = body.mapping ? checkMapping(body.mapping, sheet.headers) : guessMapping(sheet.headers);
    if (!mapping.phone && !mapping.email) {
      throw Problems.validation([{ field: 'mapping', message: 'map a column to phone or email' }]);
    }
    const preview = sheet.rows.slice(0, PREVIEW_ROWS).map((r, i) => check(i + 2, r, mapping));
    const [row] = await this.db.current
      .insert(leadImports)
      .values({ tenantId: p.tenantId, fileId: body.fileId, sourceId: body.sourceId, mapping, preview, rowsTotal: sheet.rows.length, createdBy: p.userId, duplicateMode: body.duplicateMode ?? 're_enquiry' })
      .returning();
    return LeadImportDto.from(row!);
  }

  async get(id: string): Promise<LeadImportDto> {
    return LeadImportDto.from(await this.find(id));
  }

  /** Import batches, newest first (Migration history with counts). */
  async list(): Promise<LeadImportDto[]> {
    const rows = await this.db.current.select().from(leadImports).orderBy(desc(leadImports.createdAt)).limit(50);
    return rows.map(LeadImportDto.from);
  }

  /**
   * Runs a failed batch again. Rows already imported are recognised by their submission ID (and, for skip or
   * update, by phone or email), so a retry never creates duplicates.
   */
  async retry(p: Principal, id: string): Promise<LeadImportDto> {
    const current = await this.find(id);
    if (current.status !== 'failed') throw new ProblemException(409, 'CONFLICT', 'Nothing to retry', 'Only a failed import can be retried.');
    const [row] = await this.db.current
      .update(leadImports)
      .set({ status: 'importing', attempts: current.attempts + 1, errorDetail: null, completedAt: null })
      .where(eq(leadImports.id, id))
      .returning();
    await this.queue.send<ImportJob>('lead-import', { tenantId: p.tenantId, importId: id });
    await this.audit.record('update', 'lead_imports', id, { attempts: [current.attempts, current.attempts + 1] });
    return LeadImportDto.from(row!);
  }

  /** The Excel template for a migration: one column per field, an example row, and the valid statuses. */
  async template(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Leads');
    sheet.columns = TEMPLATE.map((c) => ({ header: c.header, key: c.header, width: Math.max(14, c.header.length + 4) }));
    sheet.addRow(Object.fromEntries(TEMPLATE.map((c) => [c.header, c.example])));
    sheet.getRow(1).font = { bold: true };
    const help = wb.addWorksheet('Statuses');
    help.columns = [
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Substatus', key: 'substatus', width: 30 },
    ];
    help.getRow(1).font = { bold: true };
    const stages = (await this.config.listStages(100)).data;
    const subs = await this.config.listSubstatuses();
    for (const s of stages) {
      const own = subs.filter((x) => x.stageId === s.id && x.isActive);
      if (!own.length) help.addRow({ status: s.name, substatus: '' });
      for (const x of own) help.addRow({ status: s.name, substatus: x.name });
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async confirm(p: Principal, id: string): Promise<LeadImportDto> {
    const current = await this.find(id);
    if (current.status !== 'previewing') throw new ProblemException(409, 'CONFLICT', 'Import already started', 'This import was already confirmed.');
    const [row] = await this.db.current.update(leadImports).set({ status: 'importing' }).where(eq(leadImports.id, id)).returning();
    await this.queue.send<ImportJob>('lead-import', { tenantId: p.tenantId, importId: id });
    await this.audit.record('create', 'lead_imports', id, { rowsTotal: [null, current.rowsTotal] });
    return LeadImportDto.from(row!);
  }

  /** The background job (worker). Each row has a stable submission ID, so a retried job never imports a row twice. */
  async run(importId: string): Promise<void> {
    const job = await this.find(importId);
    if (job.status !== 'importing') return;
    try {
      const sheet = await this.sheet(job.fileId, true);
      const lookups = await this.lookups();
      let imported = 0;
      let reEnquired = 0;
      let updated = 0;
      let skipped = 0;
      const rejected: { row: number; reason: string; values: Record<string, string> }[] = [];
      for (const [i, values] of sheet.rows.entries()) {
        const rowNumber = i + 2;
        const checked = check(rowNumber, values, job.mapping);
        if (checked.status === 'rejected') {
          rejected.push({ row: rowNumber, reason: checked.errors.join('; '), values });
          continue;
        }
        const extra = resolve(job, values, lookups);
        if ('error' in extra) {
          rejected.push({ row: rowNumber, reason: extra.error, values });
          continue;
        }
        const result = await this.db.savepoint(() => this.intake.receive({ ...toIntake(job, rowNumber, values), ...extra, onExisting: job.duplicateMode }));
        if (!result.ok) {
          rejected.push({ row: rowNumber, reason: (result.error as Error).message, values });
          continue;
        }
        const r = result.value;
        if (r.status === 'created') imported++;
        else if (r.status === 're_enquired') reEnquired++;
        else if (r.status === 'updated') updated++;
        else if (r.status === 'skipped') skipped++;
        else if (r.status === 'duplicate' && job.duplicateMode !== 're_enquiry') skipped++;
        else if (r.status === 'duplicate') rejected.push({ row: rowNumber, reason: 'already imported', values });
        else rejected.push({ row: rowNumber, reason: r.errors.join('; '), values });
      }
      const rejectedFile = rejected.length
        ? await this.files.store(`rejected-rows-${importId}.csv`, 'text/csv', rejectedCsv(sheet.headers, rejected), 'import', job.createdBy)
        : undefined;
      await this.db.current
        .update(leadImports)
        .set({
          status: 'completed',
          rowsImported: imported,
          rowsReEnquired: reEnquired,
          rowsUpdated: updated,
          rowsSkipped: skipped,
          rowsRejected: rejected.length,
          rejectedRowsFileId: rejectedFile?.id ?? null,
          completedAt: new Date(),
        })
        .where(eq(leadImports.id, importId));
      await this.notifications.notify({
        userId: job.createdBy,
        type: 'import_completed',
        title: 'Lead import finished',
        body:
          job.duplicateMode === 're_enquiry'
            ? `${imported} new, ${reEnquired} re-enquired, ${rejected.length} rejected.`
            : `${imported} new, ${updated} updated, ${skipped} skipped, ${rejected.length} rejected.`,
      });
    } catch (err) {
      await this.db.current
        .update(leadImports)
        .set({ status: 'failed', errorDetail: (err as Error).message.slice(0, 1000), completedAt: new Date() })
        .where(eq(leadImports.id, importId));
    }
  }

  private async lookups(): Promise<Lookups> {
    const key = (v: string) => v.trim().toLowerCase();
    const sources = (await this.config.listSources(500)).data;
    const users = await this.directory.all();
    const stages = (await this.config.listStages(100)).data;
    const subs = await this.config.listSubstatuses();
    return {
      sources: new Map(sources.filter((s) => s.isActive).map((s) => [key(s.name), s.id])),
      users: new Map(users.filter((u) => u.status === 'active').flatMap((u) => [[key(u.email ?? ''), u.id], [key(u.fullName), u.id]] as [string, string][]).filter(([k]) => k)),
      stages: new Map(stages.flatMap((s) => [[key(s.name), { id: s.id, category: s.category, name: s.name }], [key(s.key), { id: s.id, category: s.category, name: s.name }]] as [string, { id: string; category: string; name: string }][])),
      substatuses: new Map(subs.filter((x) => x.isActive).map((x) => [`${x.stageId}:${key(x.name)}`, x.id])),
      projects: await this.projects.idsByName(),
    };
  }

  private async find(id: string): Promise<ImportRow> {
    const [row] = await this.db.current.select().from(leadImports).where(eq(leadImports.id, id)).limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }

  private async sheet(fileId: string, system = false): Promise<Sheet> {
    const { file, body } = system ? await this.files.readSystem(fileId) : await this.files.read(fileId);
    try {
      return await readSheet(body, file.mimeType, file.fileName);
    } catch {
      throw Problems.validation([{ field: 'fileId', message: 'the file could not be read as Excel (.xlsx) or CSV' }]);
    }
  }
}

function guessMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const byName = new Map(headers.map((h) => [h.toLowerCase().replace(/[_\s]+/g, ' ').trim(), h]));
  for (const field of IMPORT_FIELDS) {
    const hit = HEADER_GUESSES[field].find((g) => byName.has(g));
    if (hit) mapping[field] = byName.get(hit)!;
  }
  return mapping;
}

function checkMapping(mapping: Record<string, string>, headers: string[]): Record<string, string> {
  const errors = Object.entries(mapping).flatMap(([field, header]) => [
    ...((IMPORT_FIELDS as readonly string[]).includes(field) ? [] : [{ field: `mapping.${field}`, message: 'not a CRM field' }]),
    ...(headers.includes(header) ? [] : [{ field: `mapping.${field}`, message: `no column "${header}" in the file` }]),
  ]);
  if (errors.length) throw Problems.validation(errors);
  return mapping;
}

/** Excel often drops the "+" of international numbers: digits with a country code (not starting with 0) get it back. */
function importPhone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/[\s().-]/g, '');
  return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : value;
}

function check(row: number, values: Record<string, string>, mapping: Record<string, string>): PreviewRow {
  const get = (f: ImportField) => (mapping[f] ? values[mapping[f]!] : undefined) || undefined;
  const errors: string[] = [];
  const phone = importPhone(get('phone'));
  const email = get('email');
  if (phone && !normalizePhone(phone)) errors.push(`invalid phone "${get('phone')}"`);
  if (email && !normalizeEmail(email)) errors.push(`invalid email "${email}"`);
  if (!phone && !email) errors.push('no phone or email');
  return { row, values, status: errors.length ? 'rejected' : 'ok', errors };
}

function toIntake(job: ImportRow, row: number, values: Record<string, string>): IntakeInput {
  const get = (f: ImportField) => (job.mapping[f] ? values[job.mapping[f]!] : undefined) || null;
  const money = (v: string | null) => (v && /^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, '')) ? v.replace(/,/g, '') : null);
  const submitted = get('submittedAt');
  const date = submitted ? new Date(submitted) : undefined;
  const country = get('countryCode');
  const language = get('preferredLanguage');
  const currency = get('budgetCurrency');
  return {
    sourceId: job.sourceId,
    fullName: get('fullName'),
    phone: importPhone(get('phone') ?? undefined) ?? null,
    phoneAlternate: importPhone(get('phoneAlternate') ?? undefined) ?? null,
    email: get('email'),
    countryCode: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
    city: get('city'),
    preferredLanguage: language && /^[A-Za-z]{2}$/.test(language) ? language.toLowerCase() : null,
    budgetMin: money(get('budgetMin')),
    budgetMax: money(get('budgetMax')),
    budgetCurrency: currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : money(get('budgetMin')) || money(get('budgetMax')) ? 'AED' : null,
    formName: get('formName'),
    note: get('note'),
    // A stable ID per row: the file's own ID column when mapped, else import + row number.
    externalSubmissionId: get('externalSubmissionId') ?? `import:${job.id}:${row}`,
    submittedAt: date && !Number.isNaN(date.getTime()) ? date : undefined,
    formAnswers: values,
  };
}

/** Source, owner, status, substatus, project and created date of a row, by name; an error rejects the row. */
function resolve(job: ImportRow, values: Record<string, string>, l: Lookups): Partial<IntakeInput> | { error: string } {
  const get = (f: ImportField) => (job.mapping[f] ? values[job.mapping[f]!]?.trim() : undefined) || undefined;
  const out: Partial<IntakeInput> = {};
  const source = get('source');
  if (source) {
    const id = l.sources.get(source.toLowerCase());
    if (!id) return { error: `unknown source "${source}"` };
    out.sourceId = id;
  }
  const owner = get('owner');
  if (owner) {
    const id = l.users.get(owner.toLowerCase());
    if (!id) return { error: `no active user "${owner}"` };
    out.ownerUserId = id;
  }
  const status = get('status');
  const substatus = get('substatus');
  if (status) {
    const stage = l.stages.get(status.toLowerCase());
    if (!stage) return { error: `unknown status "${status}" (Hot, Warm, Cold or Sale Done)` };
    out.stageId = stage.id;
    if (substatus) {
      const id = l.substatuses.get(`${stage.id}:${substatus.toLowerCase()}`);
      if (!id) return { error: `"${substatus}" is not a substatus of ${stage.name}` };
      out.substatusId = id;
    } else if (stage.category === 'lost' || stage.category === 'invalid') {
      return { error: `${stage.name} needs a substatus` };
    }
  } else if (substatus) {
    return { error: 'a substatus needs a status' };
  }
  const project = get('project');
  if (project) {
    const ids = project.split(/[;,]/).map((p) => p.trim()).filter(Boolean).map((p) => l.projects.get(p.toLowerCase()));
    if (ids.some((id) => !id)) return { error: `unknown project in "${project}"` };
    out.projectIds = ids as string[];
  }
  const created = get('createdDate');
  if (created) {
    const date = new Date(created);
    if (Number.isNaN(date.getTime()) || date > new Date()) return { error: `invalid created date "${created}"` };
    out.createdAt = date;
  }
  return out;
}

function rejectedCsv(headers: string[], rows: { row: number; reason: string; values: Record<string, string> }[]): Buffer {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [['Row', 'Reason', ...headers].map(esc).join(',')];
  for (const r of rows) lines.push([String(r.row), r.reason, ...headers.map((h) => r.values[h] ?? '')].map(esc).join(','));
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}
