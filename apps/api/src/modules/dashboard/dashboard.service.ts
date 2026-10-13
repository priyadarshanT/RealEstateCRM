import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { Problems } from '../../core/errors/problem';
import { IsDateOnly, IsUuid } from '../../core/http/validators';
import { LeadReportingService, ReportFilters } from '../leads/lead-reporting.service';
import { LeadsModule } from '../leads/leads.module';
import { MarketingModule } from '../marketing/marketing.module';
import { MarketingService } from '../marketing/marketing.service';
import { OrganizationModule } from '../organization/organization.module';
import { SettingsModule } from '../settings/settings.module';
import { TasksModule } from '../tasks/tasks.module';
import { TasksService } from '../tasks/tasks.service';
import { LabelsService } from './labels.service';

const ZERO = '0.00';

// ---------------------------------------------------------------- DTOs (components.schemas.Dashboard, CountBucket)
export class FiltersQuery implements ReportFilters {
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() to?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() projectId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() sourceId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() campaignId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() teamId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() userId?: string;
}

export class CountBucketDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty() count!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) value?: string | null;
  @ApiPropertyOptional({ type: Object, description: 'Filters that open the underlying records' }) drillDown?: Record<string, unknown>;
}

export class KpisDto {
  @ApiPropertyOptional() total!: number;
  @ApiPropertyOptional() new!: number;
  @ApiPropertyOptional() untouched!: number;
  @ApiPropertyOptional() overdue!: number;
  @ApiPropertyOptional() reEnquired!: number;
  @ApiPropertyOptional() meetingsToday!: number;
  @ApiPropertyOptional() qualified!: number;
  @ApiPropertyOptional() eois!: number;
  @ApiPropertyOptional() bookings!: number;
  @ApiPropertyOptional() salesValue!: string;
  @ApiPropertyOptional() unpaidInvoices!: string;
}

export class TrendPointDto {
  @ApiPropertyOptional({ format: 'date' }) date!: string;
  @ApiPropertyOptional() leads!: number;
  @ApiPropertyOptional() qualified!: number;
  @ApiPropertyOptional() spend!: string;
  @ApiPropertyOptional() sales!: string;
}

export class DashboardDto {
  @ApiProperty({ type: KpisDto }) kpis!: KpisDto;
  @ApiPropertyOptional({ type: [CountBucketDto] }) bySource!: CountBucketDto[];
  @ApiPropertyOptional({ type: [CountBucketDto] }) byProject!: CountBucketDto[];
  @ApiPropertyOptional({ type: [CountBucketDto] }) byStage!: CountBucketDto[];
  @ApiProperty({ type: [CountBucketDto] }) funnel!: CountBucketDto[];
  @ApiPropertyOptional({ type: [CountBucketDto] }) byAgent!: CountBucketDto[];
  @ApiPropertyOptional({ type: [CountBucketDto] }) byCampaign!: CountBucketDto[];
  @ApiPropertyOptional({ type: [TrendPointDto] }) trend!: TrendPointDto[];
  @ApiProperty({ format: 'date-time' }) refreshedAt!: string;
}

/**
 * Role-based dashboard (SRS §10): every figure is limited to the user's data scope, so an agent sees their own
 * work, managers their teams, GM and Director the company. Each bucket carries the GET /leads filters behind it.
 * Sales value and unpaid invoices come from deals and invoices (Phase 3) and are 0 until then.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly reporting: LeadReportingService,
    private readonly tasks: TasksService,
    private readonly marketing: MarketingService,
    private readonly labels: LabelsService,
  ) {}

  async get(p: Principal, f: ReportFilters): Promise<DashboardDto> {
    if (f.from && f.to && f.to < f.from) throw Problems.validation([{ field: 'to', message: 'must be on or after from' }]);
    const base = drill(f);
    const [kpis, meetingsToday, bySource, byProject, byStage, byAgent, byCampaign, funnel, trend, spend] = await Promise.all([
      this.reporting.kpis(p, f),
      this.tasks.meetingsToday(p),
      this.reporting.groupBy(p, f, 'source'),
      this.reporting.groupBy(p, f, 'project'),
      this.reporting.groupBy(p, f, 'stage'),
      this.reporting.groupBy(p, f, 'agent'),
      this.reporting.groupBy(p, f, 'campaign'),
      this.reporting.funnel(p, f),
      this.reporting.trend(p, f),
      this.marketing.spendByDay(f.from, f.to, f.sourceId, f.campaignId),
    ]);
    const [sources, stages, agents, campaigns] = await Promise.all([
      this.labels.sources(bySource.map((b) => b.key)),
      this.labels.stages(byStage.map((b) => b.key)),
      this.labels.users(byAgent.map((b) => b.key).filter((k) => k !== 'none')),
      this.labels.campaigns(byCampaign.map((b) => b.key).filter((k) => k !== 'none')),
    ]);
    const days = new Set([...trend.map((t) => t.date), ...spend.keys()]);
    const trendOf = new Map(trend.map((t) => [t.date, t]));
    return {
      kpis: { ...kpis, meetingsToday, salesValue: ZERO, unpaidInvoices: ZERO },
      bySource: bySource.map((b) => ({ key: b.key, label: sources.get(b.key) ?? b.key, count: b.count, drillDown: { ...base, sourceId: b.key } })),
      byProject: byProject.map((b) => ({ key: b.key, label: b.key, count: b.count, drillDown: { ...base, projectId: b.key } })),
      byStage: byStage.map((b) => ({ key: b.key, label: stages.get(b.key) ?? b.key, count: b.count, drillDown: { ...base, stageId: b.key } })),
      byAgent: byAgent.map((b) =>
        b.key === 'none'
          ? { key: 'unassigned', label: 'Unassigned', count: b.count, drillDown: { ...base, tab: 'unassigned' } }
          : { key: b.key, label: agents.get(b.key) ?? b.key, count: b.count, drillDown: { ...base, ownerUserId: b.key } },
      ),
      byCampaign: byCampaign
        .filter((b) => b.key !== 'none')
        .map((b) => ({ key: b.key, label: campaigns.get(b.key) ?? b.key, count: b.count, drillDown: { ...base, campaignId: b.key } })),
      funnel: funnel.map((s) => ({ key: s.key, label: s.label, count: s.count, drillDown: base })),
      trend: [...days].sort().map((date) => ({
        date,
        leads: trendOf.get(date)?.leads ?? 0,
        qualified: trendOf.get(date)?.qualified ?? 0,
        spend: spend.get(date) ?? ZERO,
        sales: ZERO,
      })),
      refreshedAt: new Date().toISOString(),
    };
  }
}

/** The dashboard filters as GET /leads query parameters. */
function drill(f: ReportFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.from) out.createdFrom = f.from;
  if (f.to) out.createdTo = f.to;
  for (const key of ['projectId', 'sourceId', 'campaignId', 'teamId'] as const) if (f[key]) out[key] = f[key]!;
  if (f.userId) out.ownerUserId = f.userId;
  return out;
}

@ApiTags('Dashboard')
@ApiBearerAuth('bearer')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getDashboard', summary: 'Dashboard' })
  @ApiOkResponse({ type: DashboardDto })
  get(@CurrentPrincipal() p: Principal, @Query() query: FiltersQuery): Promise<DashboardDto> {
    return this.dashboard.get(p, query);
  }
}

/** KPIs and charts (SRS §10). */
@Module({
  imports: [LeadsModule, TasksModule, MarketingModule, SettingsModule, OrganizationModule],
  controllers: [DashboardController],
  providers: [DashboardService, LabelsService],
  exports: [LabelsService],
})
export class DashboardModule {}
