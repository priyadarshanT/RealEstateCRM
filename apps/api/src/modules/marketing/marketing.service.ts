import { Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { and, asc, eq, gte, inArray, lte, sql, SQL } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { DbService } from '../../core/database/db.service';
import { ProblemException, Problems } from '../../core/errors/problem';
import { pgCode, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from '../../core/errors/pg';
import { versionConflict } from '../../core/http/etag';
import { decodeCursor, PageInfo, PageQuery, toPage } from '../../core/http/pagination';
import { IsUuid } from '../../core/http/validators';
import { adSpendDaily, CampaignRow, campaigns } from './marketing.schema';

const MONEY = /^\d+(\.\d{1,2})?$/;
const STATUSES = ['active', 'paused', 'ended'] as const;

// ---------------------------------------------------------------- DTOs (components.schemas.Campaign, AdSpend)
export class CampaignDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) externalId!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: STATUSES }) status!: CampaignRow['status'];
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) startsOn!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) endsOn!: string | null;

  static from(c: CampaignRow): CampaignDto {
    return { id: c.id, sourceId: c.sourceId, externalId: c.externalId, name: c.name, status: c.status, startsOn: c.startsOn, endsOn: c.endsOn };
  }
}

export class CampaignPage {
  @ApiProperty({ type: [CampaignDto] }) data!: CampaignDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class CampaignListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() sourceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(STATUSES) status?: CampaignRow['status'];
}

export class CampaignInputDto {
  @IsOptional() @IsUuid() id?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() sourceId?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(100) externalId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional({ enum: STATUSES }) @IsOptional() @IsIn(STATUSES) status?: CampaignRow['status'];
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true }) startsOn?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true }) endsOn?: string | null;
}

export class AdSpendDto {
  @ApiProperty({ format: 'date' }) @IsDateString({ strict: true }) spendDate!: string;
  @ApiProperty() @Matches(MONEY, { message: 'amount must be a positive decimal with up to 2 places' }) amount!: string;
  @ApiProperty({ pattern: '^[A-Z]{3}$' }) @Matches(/^[A-Z]{3}$/) currency!: string;
  @ApiPropertyOptional({ enum: ['api', 'manual'] }) @IsOptional() @IsIn(['api', 'manual']) entryMethod?: 'api' | 'manual';
}

export class AdSpendList {
  @ApiProperty({ type: [AdSpendDto] }) data!: AdSpendDto[];
}

export class EnterSpendDto {
  @ApiPropertyOptional({ type: [AdSpendDto] }) @IsArray() @ArrayMaxSize(366) @ValidateNested({ each: true }) @Type(() => AdSpendDto) days!: AdSpendDto[];
}

export class SpendQuery {
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) to?: string;
}

/** Ad campaigns and daily spend (SRS §8.3: spend imported daily from ad accounts or entered manually). */
@Injectable()
export class MarketingService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(q: CampaignListQuery) {
    const where: (SQL | undefined)[] = [q.sourceId ? eq(campaigns.sourceId, q.sourceId) : undefined, q.status ? eq(campaigns.status, q.status) : undefined];
    if (q.cursor) {
      const [name, id] = decodeCursor(q.cursor, 2) as [string, string];
      where.push(sql`(${campaigns.name}, ${campaigns.id}) > (${name}, ${id}::uuid)`);
    }
    const rows = await this.db.current.select().from(campaigns).where(and(...where)).orderBy(asc(campaigns.name), asc(campaigns.id)).limit(q.limit + 1);
    return toPage(rows, q.limit, (r) => [r.name, r.id], CampaignDto.from);
  }

  async get(id: string): Promise<CampaignRow> {
    const [row] = await this.db.current.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }

  async create(body: CampaignInputDto): Promise<CampaignRow> {
    const missing = (['sourceId', 'name'] as const).filter((f) => !body[f]);
    if (missing.length) throw Problems.validation(missing.map((field) => ({ field, message: `${field} is required` })));
    const [row] = await this.db.current
      .insert(campaigns)
      .values({
        tenantId: this.db.currentTenantId!,
        sourceId: body.sourceId!,
        externalId: body.externalId ?? null,
        name: body.name!,
        status: body.status ?? 'active',
        startsOn: body.startsOn ?? null,
        endsOn: body.endsOn ?? null,
      })
      .returning()
      .catch(rethrow);
    await this.audit.record('create', 'campaigns', row!.id, { name: [null, row!.name] });
    return row!;
  }

  async update(id: string, body: CampaignInputDto, expectedVersion?: string): Promise<CampaignRow> {
    const before = await this.get(id);
    const patch: Partial<CampaignRow> = {};
    for (const key of ['sourceId', 'externalId', 'name', 'status', 'startsOn', 'endsOn'] as const) {
      if (body[key] !== undefined) (patch as Record<string, unknown>)[key] = body[key];
    }
    if (!Object.keys(patch).length) return before;
    const [after] = await this.db.current
      .update(campaigns)
      .set(patch)
      .where(and(eq(campaigns.id, id), expectedVersion ? eq(campaigns.updatedAt, expectedVersion) : undefined))
      .returning()
      .catch(rethrow);
    if (!after) throw versionConflict();
    await this.audit.recordUpdate('campaigns', id, view(before), view(after));
    return after;
  }

  async spend(id: string, q: SpendQuery): Promise<AdSpendDto[]> {
    await this.get(id);
    const rows = await this.db.current
      .select()
      .from(adSpendDaily)
      .where(and(eq(adSpendDaily.campaignId, id), q.from ? gte(adSpendDaily.spendDate, q.from) : undefined, q.to ? lte(adSpendDaily.spendDate, q.to) : undefined))
      .orderBy(asc(adSpendDaily.spendDate));
    return rows.map((r) => ({ spendDate: r.spendDate, amount: Number(r.amount).toFixed(2), currency: r.currency, entryMethod: r.entryMethod }));
  }

  /** Manual entry: days already imported from the ad platform are kept (only the import overwrites them). */
  async enterSpend(id: string, days: AdSpendDto[]): Promise<void> {
    await this.get(id);
    const dates = new Set<string>();
    for (const d of days) {
      if (dates.has(d.spendDate)) throw Problems.validation([{ field: 'days', message: `${d.spendDate} appears twice` }]);
      dates.add(d.spendDate);
    }
    const tenantId = this.db.currentTenantId!;
    for (const d of days) {
      await this.db.current
        .insert(adSpendDaily)
        .values({ tenantId, campaignId: id, spendDate: d.spendDate, amount: d.amount, currency: d.currency, entryMethod: 'manual' })
        .onConflictDoUpdate({
          target: [adSpendDaily.campaignId, adSpendDaily.spendDate],
          set: { amount: d.amount, currency: d.currency, updatedAt: new Date() },
          setWhere: sql`${adSpendDaily.entryMethod} = 'manual'`,
        })
        .catch(rethrow);
    }
    await this.audit.record('update', 'ad_spend_daily', id, { days: [null, days.map((d) => `${d.spendDate}: ${d.amount} ${d.currency}`)] });
  }

  /** Spend per campaign in a period (marketing report). Amounts are summed per currency. */
  async spendByCampaign(from?: string, to?: string): Promise<{ campaignId: string; currency: string; amount: string }[]> {
    const rows = await this.db.current
      .select({ campaignId: adSpendDaily.campaignId, currency: adSpendDaily.currency, amount: sql<string>`sum(${adSpendDaily.amount})::text` })
      .from(adSpendDaily)
      .where(and(from ? gte(adSpendDaily.spendDate, from) : undefined, to ? lte(adSpendDaily.spendDate, to) : undefined))
      .groupBy(adSpendDaily.campaignId, adSpendDaily.currency);
    return rows;
  }

  /** Spend per day in a period (dashboard trend), optionally for one source or campaign. */
  async spendByDay(from?: string, to?: string, sourceId?: string, campaignId?: string): Promise<Map<string, string>> {
    const rows = await this.db.current
      .select({ date: sql<string>`to_char(${adSpendDaily.spendDate}, 'YYYY-MM-DD')`, amount: sql<string>`sum(${adSpendDaily.amount})::text` })
      .from(adSpendDaily)
      .innerJoin(campaigns, eq(campaigns.id, adSpendDaily.campaignId))
      .where(
        and(
          from ? gte(adSpendDaily.spendDate, from) : undefined,
          to ? lte(adSpendDaily.spendDate, to) : undefined,
          sourceId ? eq(campaigns.sourceId, sourceId) : undefined,
          campaignId ? eq(adSpendDaily.campaignId, campaignId) : undefined,
        ),
      )
      .groupBy(sql`1`);
    return new Map(rows.map((r) => [r.date, Number(r.amount).toFixed(2)]));
  }

  async names(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.db.current.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(inArray(campaigns.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** For the ad-spend import job (integrations): API figures replace whatever was there. */
  async importSpend(campaignId: string, day: { spendDate: string; amount: string; currency: string }): Promise<void> {
    await this.db.current
      .insert(adSpendDaily)
      .values({ tenantId: this.db.currentTenantId!, campaignId, ...day, entryMethod: 'api' })
      .onConflictDoUpdate({ target: [adSpendDaily.campaignId, adSpendDaily.spendDate], set: { amount: day.amount, currency: day.currency, entryMethod: 'api', updatedAt: new Date() } });
  }

  /** Campaign of a source by its ID at the ad platform, created on first sight (Meta intake). */
  async findOrCreateExternal(sourceId: string, externalId: string, name: string): Promise<string> {
    const [existing] = await this.db.current
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.sourceId, sourceId), eq(campaigns.externalId, externalId)))
      .limit(1);
    if (existing) return existing.id;
    const [row] = await this.db.current
      .insert(campaigns)
      .values({ tenantId: this.db.currentTenantId!, sourceId, externalId, name })
      .onConflictDoNothing()
      .returning({ id: campaigns.id });
    if (row) return row.id;
    return this.findOrCreateExternal(sourceId, externalId, name);
  }
}

function view(c: CampaignRow) {
  return { sourceId: c.sourceId, externalId: c.externalId, name: c.name, status: c.status, startsOn: c.startsOn, endsOn: c.endsOn };
}

function rethrow(err: unknown): never {
  if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ProblemException(409, 'CONFLICT', 'Campaign already exists', 'This source already has a campaign with that external ID.');
  if (pgCode(err) === PG_FOREIGN_KEY_VIOLATION) throw Problems.validation([{ field: 'sourceId', message: 'unknown source or currency' }]);
  if (pgCode(err) === '23514') throw Problems.validation([{ field: 'endsOn', message: 'must be on or after startsOn' }]);
  throw err;
}
