import { Injectable, OnModuleInit } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';
import { eq } from 'drizzle-orm';
import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { AuditService } from '../../../core/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import { DbService } from '../../../core/database/db.service';
import { ProblemException, Problems } from '../../../core/errors/problem';
import { FilesService } from '../../../core/files/files.service';
import { IsUuid } from '../../../core/http/validators';
import { TenantJob, QueueService } from '../../../core/queue/queue.service';
import { NotificationsService } from '../../notifications/notifications.service';
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
});
type ImportRow = typeof leadImports.$inferSelect;

/** CRM fields a column can be mapped to. */
export const IMPORT_FIELDS = [
  'fullName',
  'phone',
  'phoneAlternate',
  'email',
  'countryCode',
  'preferredLanguage',
  'budgetMin',
  'budgetMax',
  'budgetCurrency',
  'formName',
  'note',
  'submittedAt',
  'externalSubmissionId',
] as const;
type ImportField = (typeof IMPORT_FIELDS)[number];

/** Header names recognised automatically when no mapping is sent. */
const HEADER_GUESSES: Record<ImportField, string[]> = {
  fullName: ['name', 'full name', 'fullname', 'client name', 'customer name', 'lead name'],
  phone: ['phone', 'mobile', 'phone number', 'mobile number', 'contact number', 'whatsapp'],
  phoneAlternate: ['alternate phone', 'phone 2', 'second phone', 'other phone'],
  email: ['email', 'e-mail', 'email address'],
  countryCode: ['country', 'country code', 'nationality'],
  preferredLanguage: ['language', 'preferred language'],
  budgetMin: ['budget min', 'min budget', 'budget from'],
  budgetMax: ['budget', 'budget max', 'max budget', 'budget to'],
  budgetCurrency: ['currency', 'budget currency'],
  formName: ['form', 'form name'],
  note: ['note', 'notes', 'comment', 'comments', 'remarks'],
  submittedAt: ['date', 'created', 'submitted at', 'enquiry date'],
  externalSubmissionId: ['id', 'lead id', 'submission id', 'row id'],
};

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
    };
  }
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
      .values({ tenantId: p.tenantId, fileId: body.fileId, sourceId: body.sourceId, mapping, preview, rowsTotal: sheet.rows.length, createdBy: p.userId })
      .returning();
    return LeadImportDto.from(row!);
  }

  async get(id: string): Promise<LeadImportDto> {
    return LeadImportDto.from(await this.find(id));
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
      let imported = 0;
      let reEnquired = 0;
      const rejected: { row: number; reason: string; values: Record<string, string> }[] = [];
      for (const [i, values] of sheet.rows.entries()) {
        const rowNumber = i + 2;
        const checked = check(rowNumber, values, job.mapping);
        if (checked.status === 'rejected') {
          rejected.push({ row: rowNumber, reason: checked.errors.join('; '), values });
          continue;
        }
        const result = await this.db.savepoint(() => this.intake.receive(toIntake(job, rowNumber, values)));
        if (!result.ok) {
          rejected.push({ row: rowNumber, reason: (result.error as Error).message, values });
          continue;
        }
        const r = result.value;
        if (r.status === 'created') imported++;
        else if (r.status === 're_enquired') reEnquired++;
        else if (r.status === 'duplicate') rejected.push({ row: rowNumber, reason: 'already imported', values });
        else rejected.push({ row: rowNumber, reason: r.errors.join('; '), values });
      }
      const rejectedFile = rejected.length
        ? await this.files.store(`rejected-rows-${importId}.csv`, 'text/csv', rejectedCsv(sheet.headers, rejected), 'import', job.createdBy)
        : undefined;
      await this.db.current
        .update(leadImports)
        .set({ status: 'completed', rowsImported: imported, rowsReEnquired: reEnquired, rowsRejected: rejected.length, rejectedRowsFileId: rejectedFile?.id ?? null, completedAt: new Date() })
        .where(eq(leadImports.id, importId));
      await this.notifications.notify({
        userId: job.createdBy,
        type: 'import_completed',
        title: 'Lead import finished',
        body: `${imported} new, ${reEnquired} re-enquired, ${rejected.length} rejected.`,
      });
    } catch (err) {
      await this.db.current
        .update(leadImports)
        .set({ status: 'failed', errorDetail: (err as Error).message.slice(0, 1000), completedAt: new Date() })
        .where(eq(leadImports.id, importId));
    }
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

function rejectedCsv(headers: string[], rows: { row: number; reason: string; values: Record<string, string> }[]): Buffer {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [['Row', 'Reason', ...headers].map(esc).join(',')];
  for (const r of rows) lines.push([String(r.row), r.reason, ...headers.map((h) => r.values[h] ?? '')].map(esc).join(','));
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}
