import { Injectable, OnModuleInit } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional } from 'class-validator';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid, integer } from 'drizzle-orm/pg-core';
import ExcelJS from 'exceljs';
import { AuditService } from '../../core/audit/audit.service';
import { DataScope, Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { ProblemException, Problems } from '../../core/errors/problem';
import { FilesService } from '../../core/files/files.service';
import { decodeCursor, encodeCursor, Page, PageInfo } from '../../core/http/pagination';
import { QueueService, TenantJob } from '../../core/queue/queue.service';
import { LabelsService } from '../dashboard/labels.service';
import { EventsService } from '../events/events.service';
import { dayAfter, dayStart } from '../../core/http/dates';
import { exportPage, LeadReportingService, ReportFilters } from '../leads/lead-reporting.service';
import { LeadsService } from '../leads/leads.service';
import { OrganizationDirectory } from '../organization/directory.service';
import { MarketingService } from '../marketing/marketing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TasksService } from '../tasks/tasks.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { AttendanceService } from '../attendance/attendance.service';
import { DealsService } from '../deals/deals.service';
import { CommissionsService } from '../finance/commissions.service';
import { CounterpartiesService } from '../finance/counterparties.service';
import { DocumentsService } from '../finance/documents.service';
import { ProjectsService } from '../projects/projects.service';
import { UnitsService } from '../projects/units.service';
import { CampaignsService } from '../messaging/campaigns.service';
import { exportLogs } from './export-logs.schema';
import { LEAD_LIST_EXPORT, LeadExportsService } from './lead-exports';
import { PROJECT_LIST_EXPORT, ProjectExportsService } from './project-exports';
import { ReportColumn, reportDefinitions, ReportDefinition } from './report-definitions';

export { exportLogs };
type ExportRow = typeof exportLogs.$inferSelect;

// ---------------------------------------------------------------- DTOs
export class ReportColumnDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiPropertyOptional() type?: string;
}

export class ReportDefinitionDto {
  @ApiProperty() key!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() module!: string;
  @ApiProperty({ type: [String] }) filters!: string[];
  @ApiProperty({ type: [ReportColumnDto] }) columns!: ReportColumnDto[];
}

export class ReportList {
  @ApiProperty({ type: [ReportDefinitionDto] }) data!: ReportDefinitionDto[];
}

export class ReportResultDto {
  @ApiProperty({ type: [ReportColumnDto] }) columns!: ReportColumnDto[];
  @ApiProperty({ type: [Object] }) rows!: Record<string, unknown>[];
  @ApiProperty({ type: Object }) totals!: Record<string, unknown>;
  @ApiPropertyOptional({ type: PageInfo }) page?: PageInfo & { total?: number };
}

export class ExportRequestDto {
  @ApiProperty({ enum: ['xlsx', 'csv'] }) @IsIn(['xlsx', 'csv']) format!: 'xlsx' | 'csv';
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() filters?: Record<string, unknown>;
}

export class ExportDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() reportKey!: string;
  @ApiProperty({ enum: ['xlsx', 'csv'] }) format!: 'xlsx' | 'csv';
  @ApiProperty({ enum: ['queued', 'running', 'completed', 'failed', 'expired'] }) status!: ExportRow['status'];
  @ApiPropertyOptional({ type: Number, nullable: true }) rowCount!: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Time-limited link, present when completed' }) downloadUrl!: string | null;
  @ApiProperty({ format: 'date-time', readOnly: true }) createdAt!: string;
  @ApiPropertyOptional({ format: 'uuid' }) userId?: string;
  @ApiPropertyOptional({ type: Object }) filters?: Record<string, unknown>;
}

export class ExportPage {
  @ApiProperty({ type: [ExportDto] }) data!: ExportDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

interface ExportJob extends TenantJob {
  exportId: string;
  userId: string;
  dataScope: DataScope;
  /** Lead list exports: the requester's role (contact masking). */
  roleKey?: string;
}

const COMPANY_DATA = 'company_data';
const FILTER_KEYS = ['from', 'to', 'projectId', 'sourceId', 'campaignId', 'teamId', 'userId'] as const;
const EXPORT_PAGE = 1000;
const EXPORT_MAX_ROWS = 200_000;

/**
 * Reports and exports (SRS §8): every report filters by date, project, source, campaign, team and agent and is
 * limited to the user's scope. Exports are Admin-only by default, run in the background with exactly the same
 * query as the screen (same totals), are logged, and the user is notified when the file is ready.
 */
@Injectable()
export class ReportsService implements OnModuleInit {
  private readonly reports: Map<string, ReportDefinition>;

  constructor(
    private readonly db: DbService,
    private readonly queue: QueueService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    reporting: LeadReportingService,
    private readonly tasks: TasksService,
    private readonly marketing: MarketingService,
    private readonly events: EventsService,
    labels: LabelsService,
    private readonly directory: OrganizationDirectory,
    campaigns: CampaignsService,
    integrations: IntegrationsService,
    deals: DealsService,
    documents: DocumentsService,
    commissions: CommissionsService,
    counterparties: CounterpartiesService,
    attendance: AttendanceService,
    projects: ProjectsService,
    units: UnitsService,
    private readonly leads: LeadsService,
    private readonly leadExports: LeadExportsService,
    private readonly projectExports: ProjectExportsService,
  ) {
    this.reports = new Map(
      reportDefinitions({ reporting, tasks, marketing, events, labels, campaigns, integrations, phase3: { deals, documents, commissions, counterparties, attendance, projects, units } }).map((r) => [r.key, r]),
    );
  }

  onModuleInit(): void {
    this.queue.register<ExportJob>('report-export', (job) => this.buildExport(job));
  }

  /** The reports this user may run (some need a narrower permission, e.g. connection health for Admins). */
  list(p: Principal): ReportDefinitionDto[] {
    return [...this.reports.values()].filter((r) => allowed(p, r)).map((r) => ({ key: r.key, name: r.name, module: r.module, filters: r.filters, columns: r.columns }));
  }

  async run(p: Principal, key: string, f: ReportFilters, limit: number, cursor?: string): Promise<ReportResultDto> {
    const report = this.find(key);
    if (!allowed(p, report)) throw Problems.forbidden();
    checkPeriod(f);
    const offset = report.paged && cursor ? Number(decodeCursor(cursor, 1)[0]) : 0;
    const out = await report.run(p, f, limit, offset);
    const hasMore = report.paged ? offset + out.rows.length < (out.total ?? 0) : false;
    return {
      columns: report.columns,
      rows: out.rows,
      totals: out.totals,
      page: { nextCursor: hasMore ? encodeCursor([offset + limit]) : null, hasMore, ...(report.paged ? { total: out.total } : {}) },
    };
  }

  // ---------------------------------------------------------------- exports
  async requestExport(p: Principal, key: string, body: ExportRequestDto): Promise<ExportDto> {
    const report = this.find(key);
    if (!p.permissions.has(report.exportPermission) || !allowed(p, report)) throw Problems.forbidden('Only users allowed to export (Admin by default) can export.');
    if (report.exportPermission === 'leads.export' && !(await this.leads.features()).export_leads) {
      throw new ProblemException(403, 'EXPORT_DISABLED', 'Lead export is off', 'Exporting leads is turned off in Global Configuration › Leads.');
    }
    const filters = cleanFilters(body.filters ?? {});
    checkPeriod(filters);
    const [row] = await this.db.current.insert(exportLogs).values({ tenantId: p.tenantId, userId: p.userId, reportKey: key, filters: { ...filters }, format: body.format }).returning();
    await this.queue.send<ExportJob>('report-export', { tenantId: p.tenantId, exportId: row!.id, userId: p.userId, dataScope: p.dataScope });
    await this.audit.record('export', 'export_logs', row!.id, { reportKey: [null, key], format: [null, body.format], filters: [null, filters] });
    return this.toDto(row!);
  }

  /**
   * POST /billing/data-export (SRS §12): every lead, enquiry, timeline entry, task, user, campaign and event in one
   * workbook; also while read-only and for 90 days after cancellation. Logged like every export.
   */
  async requestCompanyExport(p: Principal): Promise<ExportDto> {
    const [row] = await this.db.current.insert(exportLogs).values({ tenantId: p.tenantId, userId: p.userId, reportKey: COMPANY_DATA, filters: {}, format: 'xlsx' }).returning();
    await this.queue.send<ExportJob>('report-export', { tenantId: p.tenantId, exportId: row!.id, userId: p.userId, dataScope: 'company' });
    await this.audit.record('export', 'export_logs', row!.id, { reportKey: [null, COMPANY_DATA] });
    return this.toDto(row!);
  }

  async getExport(p: Principal, id: string): Promise<ExportDto> {
    const [row] = await this.db.current.select().from(exportLogs).where(eq(exportLogs.id, id)).limit(1);
    if (!row || (row.userId !== p.userId && !p.permissions.has('audit.view'))) throw Problems.notFound();
    const downloadUrl = row.status === 'completed' && row.fileId && row.userId === p.userId ? (await this.files.downloadLink(row.fileId)).url : null;
    return this.toDto(row, downloadUrl);
  }

  /** Export log (audit.view): who exported what, with which filters, when. */
  async log(limit: number, cursor?: string, userId?: string, from?: string, to?: string): Promise<Page<ExportDto>> {
    const offset = cursor ? Number(decodeCursor(cursor, 1)[0]) : 0;
    const rows = await this.db.current
      .select()
      .from(exportLogs)
      .where(and(userId ? eq(exportLogs.userId, userId) : undefined, from ? gte(exportLogs.createdAt, dayStart(from)) : undefined, to ? lt(exportLogs.createdAt, dayAfter(to)) : undefined))
      .orderBy(desc(exportLogs.createdAt), desc(exportLogs.id))
      .limit(limit + 1)
      .offset(offset);
    const hasMore = rows.length > limit;
    return { data: rows.slice(0, limit).map((r) => this.toDto(r)), page: { nextCursor: hasMore ? encodeCursor([offset + limit]) : null, hasMore } };
  }

  /** report-export job: same report and filters as on screen, all rows, then an .xlsx or .csv file. */
  async buildExport(job: ExportJob): Promise<void> {
    const [row] = await this.db.current.select().from(exportLogs).where(eq(exportLogs.id, job.exportId)).limit(1);
    if (!row || row.status === 'completed') return;
    await this.db.current.update(exportLogs).set({ status: 'running' }).where(eq(exportLogs.id, row.id));
    try {
      if (row.reportKey === COMPANY_DATA) {
        await this.buildCompanyExport(row, job);
        return;
      }
      if (row.reportKey === LEAD_LIST_EXPORT) {
        await this.leadExports.build(row, { ...job, roleKey: job.roleKey ?? '' });
        return;
      }
      if (row.reportKey === PROJECT_LIST_EXPORT) {
        await this.projectExports.build(row, { ...job, roleKey: job.roleKey ?? '' });
        return;
      }
      const report = this.find(row.reportKey);
      // The export runs with the requester's scope (the worker has no signed-in user).
      const principal: Principal = { userId: job.userId, tenantId: job.tenantId, dataScope: job.dataScope, email: '', roleKey: '', permissions: new Set(), tenantStatus: 'active' };
      const filters = row.filters as ReportFilters;
      const rows: Record<string, unknown>[] = [];
      let totals: Record<string, unknown> = {};
      for (let offset = 0; ; offset += EXPORT_PAGE) {
        const out = await report.run(principal, filters, EXPORT_PAGE, offset);
        rows.push(...out.rows);
        totals = out.totals;
        if (!report.paged || out.rows.length < EXPORT_PAGE || rows.length >= EXPORT_MAX_ROWS) break;
      }
      const body = row.format === 'csv' ? toCsv(report.columns, rows, totals) : await toXlsx(report.name, report.columns, rows, totals);
      const fileName = `${row.reportKey}-${new Date().toISOString().slice(0, 10)}.${row.format}`;
      const mime = row.format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const file = await this.files.store(fileName, mime, body, 'export', row.userId);
      await this.db.current.update(exportLogs).set({ status: 'completed', rowCount: rows.length, fileId: file.id, completedAt: new Date() }).where(eq(exportLogs.id, row.id));
      await this.notifications.notify({ userId: row.userId, type: 'export_ready', title: `Your export is ready: ${report.name}`, body: `${rows.length} rows` });
    } catch (err) {
      await this.db.current.update(exportLogs).set({ status: 'failed', errorDetail: (err as Error).message.slice(0, 1000), completedAt: new Date() }).where(eq(exportLogs.id, row.id));
    }
  }

  private async buildCompanyExport(row: ExportRow, job: ExportJob): Promise<void> {
    const principal: Principal = { userId: job.userId, tenantId: job.tenantId, dataScope: 'company', email: '', roleKey: '', permissions: new Set(), tenantStatus: 'active' };
    const workbook = new ExcelJS.Workbook();
    let total = 0;
    const addSheet = (name: string, rows: Record<string, unknown>[]) => {
      const sheet = workbook.addWorksheet(name);
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      sheet.columns = keys.map((k) => ({ header: k, key: k, width: 18 }));
      sheet.getRow(1).font = { bold: true };
      for (const r of rows) sheet.addRow(Object.fromEntries(keys.map((k) => [k, typeof r[k] === 'object' && r[k] !== null ? JSON.stringify(r[k]) : r[k]])));
      total += rows.length;
    };
    const all = async (page: (limit: number, offset: number) => Promise<Record<string, unknown>[]>) => {
      const rows: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += EXPORT_PAGE) {
        const batch = await page(EXPORT_PAGE, offset);
        rows.push(...batch);
        if (batch.length < EXPORT_PAGE || rows.length >= EXPORT_MAX_ROWS) return rows;
      }
    };
    const leads = this.find('leads');
    addSheet('Leads', await all(async (limit, offset) => (await leads.run(principal, {}, limit, offset)).rows));
    addSheet('Enquiries', await all((limit, offset) => exportPage(this.db, 'enquiries', limit, offset)));
    addSheet('Timeline', await all((limit, offset) => exportPage(this.db, 'timeline', limit, offset)));
    addSheet('Tasks', await all((limit, offset) => this.tasks.exportPage(limit, offset)));
    addSheet('Users', (await this.directory.all()).map((u) => ({ ...u })));
    addSheet('Campaigns', await all(async (limit, offset) => (offset ? [] : (await this.marketing.list({ limit: 200 } as never)).data.map((c) => ({ ...c })))));
    addSheet('Events', await all(async (limit, offset) => (offset ? [] : (await this.events.list({ limit: 200 } as never)).data.map((e) => ({ ...e })))));
    const body = Buffer.from(await workbook.xlsx.writeBuffer());
    const file = await this.files.store(`company-data-${new Date().toISOString().slice(0, 10)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body, 'export', row.userId);
    await this.db.current.update(exportLogs).set({ status: 'completed', rowCount: total, fileId: file.id, completedAt: new Date() }).where(eq(exportLogs.id, row.id));
    await this.notifications.notify({ userId: row.userId, type: 'export_ready', title: 'Your company data export is ready', body: `${total} rows` });
  }

  private find(key: string): ReportDefinition {
    const report = this.reports.get(key);
    if (!report) throw Problems.notFound(`There is no report called "${key}".`);
    return report;
  }

  private toDto(r: ExportRow, downloadUrl: string | null = null): ExportDto {
    return { id: r.id, reportKey: r.reportKey, format: r.format, status: r.status, rowCount: r.rowCount, downloadUrl, createdAt: r.createdAt.toISOString(), userId: r.userId, filters: r.filters };
  }
}

function cleanFilters(input: Record<string, unknown>): ReportFilters {
  const out: Record<string, string> = {};
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const errors = [];
  for (const [key, value] of Object.entries(input)) {
    if (!(FILTER_KEYS as readonly string[]).includes(key)) {
      errors.push({ field: `filters.${key}`, message: 'unknown filter' });
      continue;
    }
    const ok = typeof value === 'string' && ((key === 'from' || key === 'to') ? date.test(value) : uuid.test(value));
    if (!ok) errors.push({ field: `filters.${key}`, message: key === 'from' || key === 'to' ? 'must be a date (YYYY-MM-DD)' : 'must be a UUID' });
    else out[key] = value;
  }
  if (errors.length) throw Problems.validation(errors);
  return out;
}

function checkPeriod(f: ReportFilters): void {
  if (f.from && f.to && f.to < f.from) throw Problems.validation([{ field: 'to', message: 'must be on or after from' }]);
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function toCsv(columns: ReportColumn[], rows: Record<string, unknown>[], totals: Record<string, unknown>): Buffer {
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => esc(cell(r[c.key]))).join(','));
  lines.push(columns.map((c, i) => esc(i === 0 ? 'Total' : cell(totals[c.key]))).join(','));
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

async function toXlsx(name: string, columns: ReportColumn[], rows: Record<string, unknown>[], totals: Record<string, unknown>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(name.slice(0, 31).replace(/[:\\/?*[\]]/g, ' '));
  sheet.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 2) }));
  sheet.getRow(1).font = { bold: true };
  const value = (c: ReportColumn, v: unknown) => (v === null || v === undefined ? null : c.type === 'number' || c.type === 'money' || c.type === 'percent' ? Number(v) : v);
  for (const r of rows) sheet.addRow(Object.fromEntries(columns.map((c) => [c.key, value(c, r[c.key])])));
  const total = sheet.addRow(Object.fromEntries(columns.map((c, i) => [c.key, i === 0 ? 'Total' : value(c, totals[c.key])])));
  total.font = { bold: true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function allowed(p: Principal, r: ReportDefinition): boolean {
  // Reports without their own permission are lead reports (leads.view).
  return (r.permissions ?? ['leads.view']).some((k) => p.permissions.has(k));
}
