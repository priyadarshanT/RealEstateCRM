import { Body, Controller, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { AuditService } from '../../core/audit/audit.service';
import { AllowWhenReadOnly, CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { ProblemException, Problems } from '../../core/errors/problem';
import { FilesService } from '../../core/files/files.service';
import { decodeCursor, encodeCursor, PageInfo, PageQuery } from '../../core/http/pagination';
import { IsUuid } from '../../core/http/validators';
import { QueueService } from '../../core/queue/queue.service';
import { LabelsService } from '../dashboard/labels.service';
import { LEAD_DATE_FIELDS, LEAD_TABS, LeadListQuery } from '../leads/dto/lead.dto';
import { LeadsService } from '../leads/leads.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganizationDirectory } from '../organization/directory.service';
import { OrganizationService } from '../organization/organization.service';
import { ProjectsService } from '../projects/projects.service';
import { SettingsService } from '../settings/settings.service';
import { exportLogs } from './export-logs.schema';

// Export Leads and Export Tracker (stakeholder update 2026-10-17, Lead page §5–6): an Excel file of the selected
// or all filtered leads with the user's columns in their order, made in the background and listed in the tracker.

export const LEAD_LIST_EXPORT = 'lead_list';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PAGE = 1000;
const MAX_ROWS = 100_000;

/** Columns a lead export can contain (the Lead page's Manage Columns), with their Excel header. */
export const LEAD_EXPORT_COLUMNS: Record<string, string> = {
  name: 'Name',
  phone: 'Phone',
  email: 'Email',
  country: 'Country',
  project: 'Project',
  source: 'Source',
  campaign: 'Campaign',
  agent: 'Assigned To',
  secondaryOwner: 'Secondary Owner',
  assignedFrom: 'Assigned From',
  priority: 'Priority',
  score: 'Score',
  stage: 'Status',
  substatus: 'Substatus',
  latestNote: 'Note',
  nextFollowUp: 'Next Follow-up',
  createdAt: 'Created',
  saleDoneAt: 'Sale Done Date',
};

const FILTER_RULES: Record<string, RegExp | readonly string[]> = {
  tab: LEAD_TABS,
  q: /^.{1,100}$/s,
  stageId: /^[0-9a-f-]{36}$/i,
  substatusId: /^[0-9a-f-]{36}$/i,
  ownerUserId: /^[0-9a-f-]{36}$/i,
  teamId: /^[0-9a-f-]{36}$/i,
  projectId: /^[0-9a-f-]{36}$/i,
  sourceId: /^[0-9a-f-]{36}$/i,
  campaignId: /^[0-9a-f-]{36}$/i,
  eventId: /^[0-9a-f-]{36}$/i,
  budgetMin: /^-?\d+(\.\d{1,2})?$/,
  budgetMax: /^-?\d+(\.\d{1,2})?$/,
  createdFrom: /^\d{4}-\d{2}-\d{2}$/,
  createdTo: /^\d{4}-\d{2}-\d{2}$/,
  dateField: LEAD_DATE_FIELDS,
  dateFrom: /^\d{4}-\d{2}-\d{2}$/,
  dateTo: /^\d{4}-\d{2}-\d{2}$/,
  sort: /^[-a-zA-Z,]{1,200}$/,
};

export class LeadExportRequestDto {
  @ApiProperty({ enum: ['selected', 'filtered'] }) @IsIn(['selected', 'filtered']) scope!: 'selected' | 'filtered';
  @ApiPropertyOptional({ type: [String], description: 'scope = selected: the chosen leads (max 5000)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ArrayUnique()
  @IsUuid({ each: true })
  leadIds?: string[];
  @ApiPropertyOptional({ type: Object, description: 'scope = filtered: the list filters (tab, q, status, owner, dates …)' }) @IsOptional() @IsObject() filters?: Record<string, unknown>;
  @ApiProperty({ type: [String], description: 'Column keys in order' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ArrayUnique()
  @IsString({ each: true })
  columns!: string[];
}

export type TrackerStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'expired';

export class LeadExportDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: 'Short export ID shown to users' }) exportId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) fileName!: string | null;
  @ApiProperty({ format: 'uuid' }) exportedBy!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) exportedByName!: string | null;
  @ApiProperty({ format: 'date-time' }) requestedAt!: string;
  @ApiProperty({ enum: ['selected', 'filtered'] }) scope!: 'selected' | 'filtered';
  @ApiProperty({ type: Object }) filters!: Record<string, unknown>;
  @ApiProperty({ type: [String] }) columns!: string[];
  @ApiPropertyOptional({ type: Number, nullable: true }) recordCount!: number | null;
  @ApiProperty({ enum: ['queued', 'processing', 'ready', 'failed', 'expired'] }) status!: TrackerStatus;
  @ApiPropertyOptional({ type: String, nullable: true }) errorDetail!: string | null;
  @ApiProperty() downloadCount!: number;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) expiresAt!: string | null;
}

export class LeadExportPage {
  @ApiProperty({ type: [LeadExportDto] }) data!: LeadExportDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo & { total?: number };
}

export class DownloadLinkDto {
  @ApiProperty() url!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

export interface LeadExportJob {
  tenantId: string;
  exportId: string;
  userId: string;
  dataScope: Principal['dataScope'];
  roleKey: string;
}

type ExportRow = typeof exportLogs.$inferSelect;
const STATUS: Record<ExportRow['status'], TrackerStatus> = { queued: 'queued', running: 'processing', completed: 'ready', failed: 'failed', expired: 'expired' };

@Injectable()
export class LeadExportsService {
  constructor(
    private readonly db: DbService,
    private readonly leads: LeadsService,
    private readonly labels: LabelsService,
    private readonly projects: ProjectsService,
    private readonly directory: OrganizationDirectory,
    private readonly organization: OrganizationService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly queue: QueueService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Export Leads: checks the Export Leads switch and permission, records the request (tracker) and queues the file. */
  async request(p: Principal, body: LeadExportRequestDto): Promise<LeadExportDto> {
    await this.assertExportAllowed(p);
    const unknown = body.columns.filter((c) => !(c in LEAD_EXPORT_COLUMNS));
    if (unknown.length) throw Problems.validation(unknown.map((c) => ({ field: 'columns', message: `unknown column "${c}"` })));
    if (body.scope === 'selected' && !body.leadIds?.length) throw Problems.validation([{ field: 'leadIds', message: 'select at least one lead' }]);
    const filters = body.scope === 'selected' ? { leadIds: body.leadIds! } : cleanFilters(body.filters ?? {});
    const [row] = await this.db.current
      .insert(exportLogs)
      .values({ tenantId: p.tenantId, userId: p.userId, reportKey: LEAD_LIST_EXPORT, filters, format: 'xlsx', scope: body.scope, columns: body.columns })
      .returning();
    await this.queue.send('report-export', { tenantId: p.tenantId, exportId: row!.id, userId: p.userId, dataScope: p.dataScope, roleKey: p.roleKey } satisfies LeadExportJob);
    await this.audit.record('export', 'export_logs', row!.id, { reportKey: [null, LEAD_LIST_EXPORT], scope: [null, body.scope], columns: [null, body.columns] });
    return (await this.toDtos([row!]))[0]!;
  }

  /** Export Tracker: own exports; managers see their teams' exports; Admins (company scope or audit.view) all. */
  async list(p: Principal, limit: number, cursor?: string): Promise<LeadExportPage> {
    await this.expireOld();
    const offset = cursor ? Number(decodeCursor(cursor, 1)[0]) : 0;
    const where = and(eq(exportLogs.reportKey, LEAD_LIST_EXPORT), await this.visibleUsers(p));
    const rows = await this.db.current.select().from(exportLogs).where(where).orderBy(desc(exportLogs.createdAt), desc(exportLogs.id)).limit(limit + 1).offset(offset);
    const [count] = await this.db.current.select({ n: sql<number>`count(*)::int` }).from(exportLogs).where(where);
    const hasMore = rows.length > limit;
    return { data: await this.toDtos(rows.slice(0, limit)), page: { nextCursor: hasMore ? encodeCursor([offset + limit]) : null, hasMore, total: count?.n ?? 0 } };
  }

  /** Download Excel again from the tracker: access, the Export Leads switch and the file's expiry are checked now. */
  async download(p: Principal, id: string): Promise<DownloadLinkDto> {
    await this.expireOld();
    const row = await this.visibleRow(p, id);
    await this.assertExportAllowed(p);
    if (row.status === 'expired') throw new ProblemException(410, 'EXPORT_EXPIRED', 'File expired', 'This export is older than the retention period; export again.');
    if (row.status !== 'completed' || !row.fileId) throw new ProblemException(409, 'CONFLICT', 'Not ready', 'The file is not ready yet.');
    const link = await this.files.systemDownloadLink(row.fileId);
    await this.db.current.update(exportLogs).set({ downloadCount: sql`${exportLogs.downloadCount} + 1` }).where(eq(exportLogs.id, id));
    await this.audit.record('export', 'export_logs', id, { downloaded: [null, row.fileId] });
    return link;
  }

  /** Failed exports can be requested again with the same scope, filters and columns. */
  async retry(p: Principal, id: string): Promise<LeadExportDto> {
    const row = await this.visibleRow(p, id);
    if (row.userId !== p.userId) throw Problems.forbidden('Only the person who requested the export can retry it.');
    await this.assertExportAllowed(p);
    if (row.status !== 'failed') throw new ProblemException(409, 'CONFLICT', 'Nothing to retry', 'Only a failed export can be retried.');
    const [after] = await this.db.current.update(exportLogs).set({ status: 'queued', errorDetail: null, completedAt: null }).where(eq(exportLogs.id, id)).returning();
    await this.queue.send('report-export', { tenantId: p.tenantId, exportId: id, userId: p.userId, dataScope: p.dataScope, roleKey: p.roleKey } satisfies LeadExportJob);
    return (await this.toDtos([after!]))[0]!;
  }

  /** Worker: builds the Excel file with the requester's access and columns. */
  async build(row: ExportRow, job: LeadExportJob): Promise<void> {
    const principal: Principal = { userId: job.userId, tenantId: job.tenantId, dataScope: job.dataScope, email: '', roleKey: job.roleKey, permissions: new Set(), tenantStatus: 'active' };
    const query = { ...(row.filters as Partial<LeadListQuery> & { leadIds?: string[] }), limit: PAGE } as LeadListQuery & { leadIds?: string[] };
    const items: Awaited<ReturnType<LeadsService['exportRows']>> = [];
    for (let offset = 0; ; offset += PAGE) {
      const batch = await this.leads.exportRows(principal, query, PAGE, offset);
      items.push(...batch);
      if (batch.length < PAGE || items.length >= MAX_ROWS) break;
    }
    const dtos = items.map((i) => i.dto);
    const [sources, campaigns, users, stages, substatuses, projectNames, tz] = await Promise.all([
      this.labels.sources(dtos.map((l) => l.sourceId)),
      this.labels.campaigns(dtos.map((l) => l.campaignId ?? '')),
      this.labels.users(dtos.flatMap((l) => [l.ownerUserId ?? '', l.secondaryOwnerUserId ?? '']).concat(items.map((i) => i.assignedFrom?.changedBy ?? ''))),
      this.labels.stages(dtos.map((l) => l.stageId)),
      this.labels.substatuses(dtos.map((l) => l.substatusId ?? '')),
      this.projects.names([...new Set(dtos.flatMap((l) => l.projectIds ?? []))]),
      this.companyTimeZone(),
    ]);
    const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }) : '');
    const value = (key: string, i: (typeof items)[number]): string | number => {
      const l = i.dto;
      switch (key) {
        case 'name': return l.fullName;
        case 'phone': return l.phonePrimary ?? '';
        case 'email': return l.email ?? '';
        case 'country': return l.countryCode ?? '';
        case 'project': return (l.projectIds ?? []).map((id) => projectNames.get(id) ?? '').filter(Boolean).join(', ');
        case 'source': return sources.get(l.sourceId) ?? '';
        case 'campaign': return l.campaignId ? (campaigns.get(l.campaignId) ?? '') : '';
        case 'agent': return l.ownerUserId ? (users.get(l.ownerUserId) ?? '') : 'Unassigned';
        case 'secondaryOwner': return l.secondaryOwnerUserId ? (users.get(l.secondaryOwnerUserId) ?? '') : '';
        case 'assignedFrom': return i.assignedFrom ? (i.assignedFrom.changedBy ? (users.get(i.assignedFrom.changedBy) ?? '') : `System (${i.assignedFrom.method.replace(/_/g, ' ')})`) : '';
        case 'priority': return l.priority ?? '';
        case 'score': return l.score;
        case 'stage': return stages.get(l.stageId) ?? '';
        case 'substatus': return l.substatusId ? (substatuses.get(l.substatusId) ?? '') : '';
        case 'latestNote': return l.latestNote ?? '';
        case 'nextFollowUp': return when(l.nextFollowUpAt);
        case 'createdAt': return when(l.createdAt);
        case 'saleDoneAt': return l.stageCategory === 'won' ? when(i.closedAt?.toISOString()) : '';
        default: return '';
      }
    };
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Leads');
    sheet.columns = row.columns.map((c) => ({ header: LEAD_EXPORT_COLUMNS[c] ?? c, key: c, width: Math.max(14, (LEAD_EXPORT_COLUMNS[c] ?? c).length + 4) }));
    sheet.getRow(1).font = { bold: true };
    for (const i of items) sheet.addRow(Object.fromEntries(row.columns.map((c) => [c, value(c, i)])));
    const fileName = `leads-${row.scope === 'selected' ? 'selected' : 'filtered'}-${new Date().toISOString().slice(0, 10)}-${row.id.slice(0, 6)}.xlsx`;
    const file = await this.files.store(fileName, XLSX, Buffer.from(await workbook.xlsx.writeBuffer()), 'export', row.userId);
    const { days } = await this.settings.get('exports.retention');
    await this.db.current
      .update(exportLogs)
      .set({ status: 'completed', rowCount: items.length, fileId: file.id, fileName, completedAt: new Date(), expiresAt: new Date(Date.now() + days * 86_400_000) })
      .where(eq(exportLogs.id, row.id));
    await this.notifications.notify({ userId: row.userId, type: 'export_ready', title: 'Your lead export is ready', body: `${items.length} leads · open Export Tracker to download` });
  }

  private async assertExportAllowed(p: Principal): Promise<void> {
    if (!p.permissions.has('leads.export')) throw Problems.forbidden('Only users allowed to export leads (Admin by default) can export.');
    if (!(await this.leads.features()).export_leads) {
      throw new ProblemException(403, 'EXPORT_DISABLED', 'Lead export is off', 'Exporting leads is turned off in Global Configuration › Leads.');
    }
  }

  private async visibleRow(p: Principal, id: string): Promise<ExportRow> {
    const [row] = await this.db.current.select().from(exportLogs).where(and(eq(exportLogs.id, id), eq(exportLogs.reportKey, LEAD_LIST_EXPORT), await this.visibleUsers(p))).limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }

  private async visibleUsers(p: Principal) {
    if (p.dataScope === 'company' || p.permissions.has('audit.view')) return undefined;
    if (p.dataScope === 'own') return eq(exportLogs.userId, p.userId);
    const teamIds = await this.directory.scopeTeamIds(p.userId, p.dataScope);
    const members = (await Promise.all(teamIds.map((t) => this.directory.teamMembers(t)))).flat().map((u) => u.id);
    return inArray(exportLogs.userId, [...new Set([p.userId, ...members])]);
  }

  /** Retention: ready files older than their expiry can no longer be downloaded (they stay listed as Expired). */
  private async expireOld(): Promise<void> {
    await this.db.current
      .update(exportLogs)
      .set({ status: 'expired' })
      .where(and(eq(exportLogs.reportKey, LEAD_LIST_EXPORT), eq(exportLogs.status, 'completed'), lt(exportLogs.expiresAt, new Date())));
  }

  private async companyTimeZone(): Promise<string> {
    return (await this.organization.getProfile(this.db.currentTenantId!)).timezone ?? 'Asia/Dubai';
  }

  private async toDtos(rows: ExportRow[]): Promise<LeadExportDto[]> {
    const names = await this.directory.users([...new Set(rows.map((r) => r.userId))]);
    return rows.map((r) => ({
      id: r.id,
      exportId: `EX-${r.id.slice(0, 8).toUpperCase()}`,
      fileName: r.fileName,
      exportedBy: r.userId,
      exportedByName: names.get(r.userId)?.fullName ?? null,
      requestedAt: r.createdAt.toISOString(),
      scope: (r.scope ?? 'filtered') as 'selected' | 'filtered',
      filters: r.scope === 'selected' ? { selectedLeads: ((r.filters as { leadIds?: string[] }).leadIds ?? []).length } : r.filters,
      columns: r.columns,
      recordCount: r.rowCount,
      status: STATUS[r.status],
      errorDetail: r.errorDetail,
      downloadCount: r.downloadCount,
      expiresAt: r.expiresAt?.toISOString() ?? null,
    }));
  }
}

function cleanFilters(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const errors: { field: string; message: string }[] = [];
  for (const [key, raw] of Object.entries(input)) {
    if (raw === undefined || raw === null || raw === '') continue;
    const rule = FILTER_RULES[key];
    const value = String(raw);
    if (!rule) errors.push({ field: `filters.${key}`, message: 'unknown filter' });
    else if (rule instanceof RegExp ? !rule.test(value) : !rule.includes(value)) errors.push({ field: `filters.${key}`, message: 'invalid value' });
    else out[key] = value;
  }
  if (errors.length) throw Problems.validation(errors);
  if (out.dateFrom && out.dateTo && out.dateTo < out.dateFrom) throw Problems.validation([{ field: 'filters.dateTo', message: 'must be on or after the start date' }]);
  return out;
}

@ApiTags('Leads')
@ApiBearerAuth('bearer')
@Controller('lead-exports')
export class LeadExportsController {
  constructor(private readonly exports: LeadExportsService) {}

  @Post()
  @HttpCode(202)
  @AllowWhenReadOnly()
  @RequirePermission('leads.export')
  @ApiOperation({ operationId: 'exportLeads', summary: 'Export selected or all filtered leads to Excel' })
  @ApiAcceptedResponse({ type: LeadExportDto })
  request(@CurrentPrincipal() p: Principal, @Body() body: LeadExportRequestDto): Promise<LeadExportDto> {
    return this.exports.request(p, body);
  }

  @Get()
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listLeadExports', summary: 'Export Tracker' })
  @ApiOkResponse({ type: LeadExportPage })
  list(@CurrentPrincipal() p: Principal, @Query() query: PageQuery): Promise<LeadExportPage> {
    return this.exports.list(p, query.limit, query.cursor);
  }

  @Post(':id/download')
  @HttpCode(200)
  @AllowWhenReadOnly()
  @RequirePermission('leads.export')
  @ApiOperation({ operationId: 'downloadLeadExport', summary: 'Download a ready export again' })
  @ApiOkResponse({ type: DownloadLinkDto })
  download(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<DownloadLinkDto> {
    return this.exports.download(p, id);
  }

  @Post(':id/retry')
  @HttpCode(202)
  @RequirePermission('leads.export')
  @ApiOperation({ operationId: 'retryLeadExport', summary: 'Retry a failed export' })
  @ApiAcceptedResponse({ type: LeadExportDto })
  retry(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<LeadExportDto> {
    return this.exports.retry(p, id);
  }
}
