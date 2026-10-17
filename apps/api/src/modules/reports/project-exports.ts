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
import { decodeCursor, encodeCursor, PageQuery } from '../../core/http/pagination';
import { IsUuid } from '../../core/http/validators';
import { QueueService } from '../../core/queue/queue.service';
import { LeadsService } from '../leads/leads.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganizationDirectory } from '../organization/directory.service';
import { CustomFieldsService } from '../projects/custom-fields';
import { CONSTRUCTION_STATUSES, PROJECT_CATEGORIES } from '../projects/projects.schema';
import { PROJECT_DATE_FIELDS, ProjectListQuery } from '../projects/dto/projects.dto';
import { ProjectsService } from '../projects/projects.service';
import { SettingsService } from '../settings/settings.service';
import { exportLogs } from './export-logs.schema';
import { DownloadLinkDto, LeadExportPage, TrackerStatus } from './lead-exports';

// Export Projects and the project Export Tracker (stakeholder update 2026-10-17, Project page §4–5): an Excel file of
// the selected or all filtered projects with the user's columns (custom fields included). Needs projects.export;
// the Export Leads switch does not grant it.

export const PROJECT_LIST_EXPORT = 'project_list';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PAGE = 500;

/** Built-in project columns and their Excel header; custom fields are `cf:<key>`. */
export const PROJECT_EXPORT_COLUMNS: Record<string, string> = {
  name: 'Project Name',
  availability: 'Availability',
  assignedTo: 'Assigned To',
  category: 'Project Type',
  status: 'Status',
  leadCount: 'Lead Count',
  developer: 'Developer',
  city: 'City',
  location: 'Location',
  startingPrice: 'Starting Price',
  currency: 'Currency',
  paymentPlan: 'Payment Plan',
  handoverDate: 'Handover Date',
  createdAt: 'Created Date',
  updatedAt: 'Updated Date',
  notes: 'Notes',
};
const STATUS_LABEL: Record<(typeof CONSTRUCTION_STATUSES)[number], string> = { off_plan: 'Off-plan', under_construction: 'Under construction', ready: 'Ready' };
const CATEGORY_LABEL: Record<(typeof PROJECT_CATEGORIES)[number], string> = { residential: 'Residential', commercial: 'Commercial', agricultural: 'Agricultural' };

const FILTER_RULES: Record<string, RegExp | readonly string[]> = {
  q: /^.{1,200}$/s,
  developerId: /^[0-9a-f-]{36}$/i,
  category: PROJECT_CATEGORIES,
  constructionStatus: CONSTRUCTION_STATUSES,
  assignedUserId: /^[0-9a-f-]{36}$/i,
  isActive: ['true', 'false'],
  dateField: PROJECT_DATE_FIELDS,
  dateFrom: /^\d{4}-\d{2}-\d{2}$/,
  dateTo: /^\d{4}-\d{2}-\d{2}$/,
};

export class ProjectExportRequestDto {
  @ApiProperty({ enum: ['selected', 'filtered'] }) @IsIn(['selected', 'filtered']) scope!: 'selected' | 'filtered';
  @ApiPropertyOptional({ type: [String], description: 'scope = selected (max 2000)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @ArrayUnique()
  @IsUuid({ each: true })
  projectIds?: string[];
  @ApiPropertyOptional({ type: Object, description: 'scope = filtered: the list filters (q, category, status, dates …)' }) @IsOptional() @IsObject() filters?: Record<string, unknown>;
  @ApiProperty({ type: [String], description: 'Column keys in order; custom fields as cf:<key>' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ArrayUnique()
  @IsString({ each: true })
  columns!: string[];
}

type ExportRow = typeof exportLogs.$inferSelect;
interface ProjectExportJob {
  tenantId: string;
  exportId: string;
  userId: string;
  dataScope: Principal['dataScope'];
  roleKey: string;
}
const STATUS: Record<ExportRow['status'], TrackerStatus> = { queued: 'queued', running: 'processing', completed: 'ready', failed: 'failed', expired: 'expired' };

@Injectable()
export class ProjectExportsService {
  constructor(
    private readonly db: DbService,
    private readonly projects: ProjectsService,
    private readonly customFields: CustomFieldsService,
    private readonly leads: LeadsService,
    private readonly directory: OrganizationDirectory,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly queue: QueueService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async request(p: Principal, body: ProjectExportRequestDto): Promise<unknown> {
    const fields = new Set((await this.customFields.list()).map((f) => `cf:${f.key}`));
    const unknown = body.columns.filter((c) => !(c in PROJECT_EXPORT_COLUMNS) && !fields.has(c));
    if (unknown.length) throw Problems.validation(unknown.map((c) => ({ field: 'columns', message: `unknown column "${c}"` })));
    if (body.scope === 'selected' && !body.projectIds?.length) throw Problems.validation([{ field: 'projectIds', message: 'select at least one project' }]);
    const filters = body.scope === 'selected' ? { projectIds: body.projectIds! } : cleanFilters(body.filters ?? {});
    const [row] = await this.db.current
      .insert(exportLogs)
      .values({ tenantId: p.tenantId, userId: p.userId, reportKey: PROJECT_LIST_EXPORT, filters, format: 'xlsx', scope: body.scope, columns: body.columns })
      .returning();
    await this.queue.send('report-export', { tenantId: p.tenantId, exportId: row!.id, userId: p.userId, dataScope: p.dataScope, roleKey: p.roleKey } satisfies ProjectExportJob);
    await this.audit.record('export', 'export_logs', row!.id, { reportKey: [null, PROJECT_LIST_EXPORT], scope: [null, body.scope], columns: [null, body.columns] });
    return (await this.toDtos([row!]))[0]!;
  }

  /** Project Export Tracker: own jobs; managers their teams'; Admins all. page.total is the badge count (jobs, not projects). */
  async list(p: Principal, limit: number, cursor?: string): Promise<LeadExportPage> {
    await this.expireOld();
    const offset = cursor ? Number(decodeCursor(cursor, 1)[0]) : 0;
    const where = and(eq(exportLogs.reportKey, PROJECT_LIST_EXPORT), await this.visibleUsers(p));
    const rows = await this.db.current.select().from(exportLogs).where(where).orderBy(desc(exportLogs.createdAt), desc(exportLogs.id)).limit(limit + 1).offset(offset);
    const [count] = await this.db.current.select({ n: sql<number>`count(*)::int` }).from(exportLogs).where(where);
    const hasMore = rows.length > limit;
    return { data: await this.toDtos(rows.slice(0, limit)), page: { nextCursor: hasMore ? encodeCursor([offset + limit]) : null, hasMore, total: count?.n ?? 0 } } as LeadExportPage;
  }

  async download(p: Principal, id: string): Promise<DownloadLinkDto> {
    await this.expireOld();
    const row = await this.visibleRow(p, id);
    if (!p.permissions.has('projects.export')) throw Problems.forbidden('Only users allowed to export projects can download project exports.');
    if (row.status === 'expired') throw new ProblemException(410, 'EXPORT_EXPIRED', 'File expired', 'This export is older than the retention period; export again.');
    if (row.status !== 'completed' || !row.fileId) throw new ProblemException(409, 'CONFLICT', 'Not ready', 'The file is not ready yet.');
    const link = await this.files.systemDownloadLink(row.fileId);
    await this.db.current.update(exportLogs).set({ downloadCount: sql`${exportLogs.downloadCount} + 1` }).where(eq(exportLogs.id, id));
    await this.audit.record('export', 'export_logs', id, { downloaded: [null, row.fileId] });
    return link;
  }

  async retry(p: Principal, id: string): Promise<unknown> {
    const row = await this.visibleRow(p, id);
    if (row.userId !== p.userId) throw Problems.forbidden('Only the person who requested the export can retry it.');
    if (row.status !== 'failed') throw new ProblemException(409, 'CONFLICT', 'Nothing to retry', 'Only a failed export can be retried.');
    const [after] = await this.db.current.update(exportLogs).set({ status: 'queued', errorDetail: null, completedAt: null }).where(eq(exportLogs.id, id)).returning();
    await this.queue.send('report-export', { tenantId: p.tenantId, exportId: id, userId: p.userId, dataScope: p.dataScope, roleKey: p.roleKey } satisfies ProjectExportJob);
    return (await this.toDtos([after!]))[0]!;
  }

  /** Worker: the Excel file with the requester's columns; Lead Count follows the requester's lead access. */
  async build(row: ExportRow, job: ProjectExportJob): Promise<void> {
    const principal: Principal = { userId: job.userId, tenantId: job.tenantId, dataScope: job.dataScope, email: '', roleKey: job.roleKey, permissions: new Set(), tenantStatus: 'active' };
    const f = row.filters as Record<string, unknown>;
    const query = { ...f, ...(f.isActive !== undefined ? { isActive: f.isActive === 'true' } : {}), limit: PAGE } as unknown as ProjectListQuery & { projectIds?: string[] };
    const items: Awaited<ReturnType<ProjectsService['exportRows']>> = [];
    for (let offset = 0; ; offset += PAGE) {
      const batch = await this.projects.exportRows(query, PAGE, offset);
      items.push(...batch);
      if (batch.length < PAGE) break;
    }
    const ids = items.map((p) => p.id);
    const [leadCounts, users, developers, fields] = await Promise.all([
      row.columns.includes('leadCount') ? this.leads.projectLeadCounts(principal, ids) : Promise.resolve(new Map<string, number>()),
      this.directory.users([...new Set(items.flatMap((p) => (p.assignedUserId ? [p.assignedUserId] : [])))]),
      this.projects.developerNames([...new Set(items.map((p) => p.developerId))]),
      this.customFields.list(),
    ]);
    const fieldOf = new Map(fields.map((x) => [`cf:${x.key}`, x]));
    const value = (key: string, p: (typeof items)[number]): string | number | boolean => {
      const field = fieldOf.get(key);
      if (field) {
        const v = p.customValues?.[field.key];
        return v === undefined || v === null ? '' : (v as string | number | boolean);
      }
      const inv = p.inventory;
      const total = inv.available + inv.onHold + inv.booked + inv.sold;
      switch (key) {
        case 'name': return p.name;
        case 'availability': return total ? `${inv.available} of ${total} available` : 'No units';
        case 'assignedTo': return p.assignedUserId ? (users.get(p.assignedUserId)?.fullName ?? '') : '';
        case 'category': return CATEGORY_LABEL[p.category];
        case 'status': return `${STATUS_LABEL[p.constructionStatus]}${p.isActive ? '' : ' (inactive)'}`;
        case 'leadCount': return leadCounts.get(p.id) ?? 0;
        case 'developer': return developers.get(p.developerId) ?? '';
        case 'city': return p.city;
        case 'location': return [p.community, p.address].filter(Boolean).join(', ');
        case 'startingPrice': return p.startingPrice ? Number(p.startingPrice.amount) : '';
        case 'currency': return p.startingPrice?.currency ?? '';
        case 'paymentPlan': return p.paymentPlan ?? '';
        case 'handoverDate': return p.handoverDate ?? '';
        case 'createdAt': return p.createdAt.slice(0, 10);
        case 'updatedAt': return p.updatedAt.slice(0, 10);
        case 'notes': return p.description ?? '';
        default: return '';
      }
    };
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Projects');
    const header = (c: string) => PROJECT_EXPORT_COLUMNS[c] ?? fieldOf.get(c)?.label ?? c;
    sheet.columns = row.columns.map((c) => ({ header: header(c), key: c, width: Math.max(14, header(c).length + 4) }));
    sheet.getRow(1).font = { bold: true };
    for (const p of items) sheet.addRow(Object.fromEntries(row.columns.map((c) => [c, value(c, p)])));
    const fileName = `projects-${row.scope === 'selected' ? 'selected' : 'filtered'}-${new Date().toISOString().slice(0, 10)}-${row.id.slice(0, 6)}.xlsx`;
    const file = await this.files.store(fileName, XLSX, Buffer.from(await workbook.xlsx.writeBuffer()), 'export', row.userId);
    const { days } = await this.settings.get('exports.retention');
    await this.db.current
      .update(exportLogs)
      .set({ status: 'completed', rowCount: items.length, fileId: file.id, fileName, completedAt: new Date(), expiresAt: new Date(Date.now() + days * 86_400_000) })
      .where(eq(exportLogs.id, row.id));
    await this.notifications.notify({ userId: row.userId, type: 'export_ready', title: 'Your project export is ready', body: `${items.length} projects · open Export Tracker to download` });
  }

  private async visibleRow(p: Principal, id: string): Promise<ExportRow> {
    const [row] = await this.db.current.select().from(exportLogs).where(and(eq(exportLogs.id, id), eq(exportLogs.reportKey, PROJECT_LIST_EXPORT), await this.visibleUsers(p))).limit(1);
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

  private async expireOld(): Promise<void> {
    await this.db.current
      .update(exportLogs)
      .set({ status: 'expired' })
      .where(and(eq(exportLogs.reportKey, PROJECT_LIST_EXPORT), eq(exportLogs.status, 'completed'), lt(exportLogs.expiresAt, new Date())));
  }

  private async toDtos(rows: ExportRow[]) {
    const names = await this.directory.users([...new Set(rows.map((r) => r.userId))]);
    return rows.map((r) => ({
      id: r.id,
      exportId: `PX-${r.id.slice(0, 8).toUpperCase()}`,
      fileName: r.fileName,
      exportedBy: r.userId,
      exportedByName: names.get(r.userId)?.fullName ?? null,
      requestedAt: r.createdAt.toISOString(),
      scope: (r.scope ?? 'filtered') as 'selected' | 'filtered',
      filters: r.scope === 'selected' ? { selectedProjects: ((r.filters as { projectIds?: string[] }).projectIds ?? []).length } : r.filters,
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

@ApiTags('Projects')
@ApiBearerAuth('bearer')
@Controller('project-exports')
export class ProjectExportsController {
  constructor(private readonly exports: ProjectExportsService) {}

  @Post()
  @HttpCode(202)
  @AllowWhenReadOnly()
  @RequirePermission('projects.export')
  @ApiOperation({ operationId: 'exportProjects', summary: 'Export selected or all filtered projects to Excel' })
  @ApiAcceptedResponse({ description: 'Export queued (same shape as LeadExport)' })
  request(@CurrentPrincipal() p: Principal, @Body() body: ProjectExportRequestDto): Promise<unknown> {
    return this.exports.request(p, body);
  }

  @Get()
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listProjectExports', summary: 'Project Export Tracker (page.total = badge count)' })
  @ApiOkResponse({ type: LeadExportPage })
  list(@CurrentPrincipal() p: Principal, @Query() query: PageQuery): Promise<LeadExportPage> {
    return this.exports.list(p, query.limit, query.cursor);
  }

  @Post(':id/download')
  @HttpCode(200)
  @AllowWhenReadOnly()
  @RequirePermission('projects.export')
  @ApiOperation({ operationId: 'downloadProjectExport', summary: 'Download a ready project export again' })
  @ApiOkResponse({ type: DownloadLinkDto })
  download(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<DownloadLinkDto> {
    return this.exports.download(p, id);
  }

  @Post(':id/retry')
  @HttpCode(202)
  @RequirePermission('projects.export')
  @ApiOperation({ operationId: 'retryProjectExport', summary: 'Retry a failed project export' })
  @ApiAcceptedResponse({ description: 'Export queued again' })
  retry(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.exports.retry(p, id);
  }
}
