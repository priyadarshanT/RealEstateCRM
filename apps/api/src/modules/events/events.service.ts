import { Body, Controller, Delete, Get, Headers, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { and, asc, eq, sql } from 'drizzle-orm';
import { char, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { Response } from 'express';
import { AuditService } from '../../core/audit/audit.service';
import { RequirePermission } from '../../core/auth/decorators';
import { DbService } from '../../core/database/db.service';
import { Problems } from '../../core/errors/problem';
import { isStillReferenced, pgCode, PG_FOREIGN_KEY_VIOLATION } from '../../core/errors/pg';
import { ProblemException } from '../../core/errors/problem';
import { parseIfMatch, toEtag, versionConflict } from '../../core/http/etag';
import { decodeCursor, PageInfo, PageQuery, toPage } from '../../core/http/pagination';
import { RequestContext } from '../../core/http/request-context';
import { IsUuid } from '../../core/http/validators';

// events (db/schema.sql, Marketing): events and roadshows that leads can be tagged to (SRS §8.5).
export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  type: text('type').$type<'event' | 'roadshow' | 'exhibition' | 'open_house'>().notNull(),
  location: text('location'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  cost: numeric('cost', { precision: 14, scale: 2 }),
  currency: char('currency', { length: 3 }),
  createdBy: uuid('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
type EventRow = typeof events.$inferSelect;
const TYPES = ['event', 'roadshow', 'exhibition', 'open_house'] as const;

// components.schemas.Event
export class EventDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: TYPES }) type!: EventRow['type'];
  @ApiPropertyOptional() location?: string;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ format: 'date-time' }) endsAt!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) cost!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) currency!: string | null;

  static from(e: EventRow): EventDto {
    return {
      id: e.id,
      name: e.name,
      type: e.type,
      location: e.location ?? undefined,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      cost: e.cost === null ? null : Number(e.cost).toFixed(2),
      currency: e.currency,
    };
  }
}

export class EventPage {
  @ApiProperty({ type: [EventDto] }) data!: EventDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class EventInputDto {
  @IsOptional() @IsUuid() id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional({ enum: TYPES }) @IsOptional() @IsIn(TYPES) type?: EventRow['type'];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) location?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() startsAt?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() endsAt?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^\d+(\.\d{1,2})?$/) cost?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^[A-Z]{3}$/) currency?: string | null;
}

/** Events and roadshows (SRS §8.5): leads are tagged to them; reports show leads, meetings, bookings and cost per event. */
@Injectable()
export class EventsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(q: PageQuery) {
    let after;
    if (q.cursor) {
      const [at, id] = decodeCursor(q.cursor, 2) as [string, string];
      after = sql`(${events.startsAt}, ${events.id}) < (${at}::timestamptz, ${id}::uuid)`;
    }
    const rows = await this.db.current.select().from(events).where(after).orderBy(sql`${events.startsAt} DESC`, sql`${events.id} DESC`).limit(q.limit + 1);
    return toPage(rows, q.limit, (r) => [r.startsAt.toISOString(), r.id], EventDto.from);
  }

  async get(id: string): Promise<EventRow> {
    const [row] = await this.db.current.select().from(events).where(eq(events.id, id)).limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }

  async create(body: EventInputDto): Promise<EventRow> {
    const missing = (['name', 'type', 'startsAt', 'endsAt'] as const).filter((f) => !body[f]);
    if (missing.length) throw Problems.validation(missing.map((field) => ({ field, message: `${field} is required` })));
    validate(body.startsAt!, body.endsAt!, body.cost ?? null, body.currency ?? null);
    const [row] = await this.db.current
      .insert(events)
      .values({
        tenantId: this.db.currentTenantId!,
        name: body.name!,
        type: body.type!,
        location: body.location ?? null,
        startsAt: new Date(body.startsAt!),
        endsAt: new Date(body.endsAt!),
        cost: body.cost ?? null,
        currency: body.currency ?? null,
        createdBy: RequestContext.get().userId ?? null,
      })
      .returning()
      .catch(rethrow);
    await this.audit.record('create', 'events', row!.id, { name: [null, row!.name] });
    return row!;
  }

  async update(id: string, body: EventInputDto, expectedVersion?: string): Promise<EventRow> {
    const before = await this.get(id);
    const startsAt = body.startsAt ?? before.startsAt.toISOString();
    const endsAt = body.endsAt ?? before.endsAt.toISOString();
    const cost = body.cost !== undefined ? body.cost : before.cost;
    const currency = body.currency !== undefined ? body.currency : before.currency;
    validate(startsAt, endsAt, cost, currency);
    const [after] = await this.db.current
      .update(events)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        cost,
        currency,
      })
      .where(and(eq(events.id, id), expectedVersion ? eq(events.updatedAt, expectedVersion) : undefined))
      .returning()
      .catch(rethrow);
    if (!after) throw versionConflict();
    await this.audit.recordUpdate('events', id, view(before), view(after));
    return after;
  }

  async delete(id: string): Promise<void> {
    const event = await this.get(id);
    await this.db.current.delete(events).where(eq(events.id, id)).catch(rethrow);
    await this.audit.record('delete', 'events', id, { name: [event.name, null] });
  }
}

function validate(startsAt: string, endsAt: string, cost: string | null, currency: string | null): void {
  const errors = [];
  if (new Date(endsAt) < new Date(startsAt)) errors.push({ field: 'endsAt', message: 'must be after startsAt' });
  if ((cost === null) !== (currency === null)) errors.push({ field: 'currency', message: 'cost and currency go together' });
  if (errors.length) throw Problems.validation(errors);
}

function view(e: EventRow) {
  return { name: e.name, type: e.type, location: e.location, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(), cost: e.cost, currency: e.currency };
}

function rethrow(err: unknown): never {
  if (isStillReferenced(err)) throw new ProblemException(409, 'CONFLICT', 'Event in use', 'Leads are tagged to this event.');
  if (pgCode(err) === PG_FOREIGN_KEY_VIOLATION) throw Problems.validation([{ field: 'currency', message: 'unknown currency' }]);
  throw err;
}

@ApiTags('Marketing')
@ApiBearerAuth('bearer')
@Controller('events')
export class EventsController {
  constructor(private readonly service: EventsService) {}

  @Get()
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listEvents', summary: 'List events and roadshows' })
  @ApiOkResponse({ type: EventPage })
  list(@Query() query: PageQuery): Promise<EventPage> {
    return this.service.list(query);
  }

  @Post()
  @RequirePermission('leads.create')
  @ApiOperation({ operationId: 'createEvent', summary: 'Create an event' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: EventDto })
  async create(@Body() body: EventInputDto, @Res({ passthrough: true }) res: Response): Promise<EventDto> {
    const row = await this.service.create(body);
    res.setHeader('ETag', toEtag(row.updatedAt));
    return EventDto.from(row);
  }

  @Get(':id')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getEvent', summary: 'Get an event' })
  @ApiOkResponse({ type: EventDto })
  async get(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<EventDto> {
    const row = await this.service.get(id);
    res.setHeader('ETag', toEtag(row.updatedAt));
    return EventDto.from(row);
  }

  @Patch(':id')
  @RequirePermission('leads.create')
  @ApiOperation({ operationId: 'updateEvent', summary: 'Update an event' })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiOkResponse({ type: EventDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: EventInputDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EventDto> {
    const row = await this.service.update(id, body, parseIfMatch(ifMatch));
    res.setHeader('ETag', toEtag(row.updatedAt));
    return EventDto.from(row);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('leads.create')
  @ApiOperation({ operationId: 'deleteEvent', summary: 'Delete an event' })
  @ApiNoContentResponse({ description: 'Done' })
  delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.service.delete(id);
  }
}

/** Events and roadshows (architecture "events" module). */
@Module({ controllers: [EventsController], providers: [EventsService], exports: [EventsService] })
export class EventsModule {}
