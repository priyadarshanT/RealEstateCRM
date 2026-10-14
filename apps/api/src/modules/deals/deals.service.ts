import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { pgCode, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from '../../core/errors/pg';
import { ProblemException, Problems } from '../../core/errors/problem';
import { FilesService } from '../../core/files/files.service';
import { decodeCursor, Page, toPage } from '../../core/http/pagination';
import { RequestContext } from '../../core/http/request-context';
import { LeadScope } from '../leads/lead-scope';
import { LeadsService } from '../leads/leads.service';
import { OrganizationDirectory } from '../organization/directory.service';
import { OrganizationService } from '../organization/organization.service';
import { UnitsService } from '../projects/units.service';
import { ProjectsService } from '../projects/projects.service';
import { UnitStatus } from '../projects/projects.schema';
import { DealDto, DealInputDto, DealListQuery, DealStageChangeDto } from './dto/deal.dto';
import { DealRow, deals, DealStage } from './deals.schema';

/** Forward order of a deal; cancelled ends it from any stage before sold. */
const ORDER: DealStage[] = ['offer', 'eoi', 'booking', 'sold'];
/** What each stage does to the unit (SRS §6.3, §6.5). */
const UNIT_STATUS: Partial<Record<DealStage, UnitStatus>> = { eoi: 'on_hold', booking: 'booked', sold: 'sold' };
const LABEL: Record<DealStage, string> = { offer: 'Offer', eoi: 'EOI', booking: 'Booking', sold: 'Sold', cancelled: 'Cancelled' };
/** Stages that hold the unit for this deal. */
const HOLDING: DealStage[] = ['eoi', 'booking', 'sold'];

const unitBooked = () => new ProblemException(409, 'UNIT_ALREADY_BOOKED', 'Unit already taken', 'Another deal holds this unit. Choose another unit.');

/**
 * Deals (SRS §6.5): a lead's purchase of one unit, from offer through EOI and booking to sale. Each stage moves the
 * unit (On Hold / Booked / Sold) and shows on the lead timeline; a unit can be held by one deal only. Who can see
 * and change a deal follows the lead.
 */
@Injectable()
export class DealsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly leads: LeadsService,
    private readonly scope: LeadScope,
    private readonly projects: ProjectsService,
    private readonly units: UnitsService,
    private readonly directory: OrganizationDirectory,
    private readonly organization: OrganizationService,
    private readonly files: FilesService,
  ) {}

  onModuleInit(): void {
    this.files.registerAccess('deal', {
      canView: async (id) => !!(await this.accessible(id, false)),
      canEdit: async (id) => !!(await this.accessible(id, true)),
    });
  }

  async list(p: Principal, q: DealListQuery): Promise<Page<DealDto>> {
    const after = q.cursor ? (([at, id]) => sql`(${deals.createdAt}, ${deals.id}) < (${at}::timestamptz, ${id}::uuid)`)(decodeCursor(q.cursor, 2) as [string, string]) : undefined;
    const rows = await this.db.current
      .select()
      .from(deals)
      .where(
        and(
          after,
          await this.scope.visibleLeadIdIn(p, deals.leadId),
          q.leadId ? eq(deals.leadId, q.leadId) : undefined,
          q.projectId ? eq(deals.projectId, q.projectId) : undefined,
          q.stage ? eq(deals.stage, q.stage) : undefined,
          q.ownerUserId ? eq(deals.ownerUserId, q.ownerUserId) : undefined,
        ),
      )
      .orderBy(desc(deals.createdAt), desc(deals.id))
      .limit(q.limit + 1);
    return toPage(rows, q.limit, (r) => [r.createdAt.toISOString(), r.id], DealDto.from);
  }

  /** A deal the principal may see (its lead is visible to them); 404 otherwise. */
  async get(p: Principal, id: string): Promise<DealRow> {
    const deal = await this.find(id);
    if (!deal) throw Problems.notFound();
    await this.leads.visible(p, deal.leadId);
    return deal;
  }

  /** A deal the principal may change (they can edit its lead). */
  async editable(p: Principal, id: string): Promise<DealRow> {
    const deal = await this.get(p, id);
    await this.leads.editable(p, deal.leadId);
    return deal;
  }

  async create(p: Principal, body: DealInputDto): Promise<DealRow> {
    const missing = (['leadId', 'projectId'] as const).filter((f) => !body[f]);
    if (missing.length) throw Problems.validation(missing.map((field) => ({ field, message: `${field} is required` })));
    const { lead } = await this.leads.editable(p, body.leadId!);
    await this.projects.getProject(body.projectId!).catch(() => {
      throw Problems.validation([{ field: 'projectId', message: 'project not found' }]);
    });
    if (body.unitId) await this.checkUnit(body.projectId!, body.unitId, null);
    const ownerUserId = body.ownerUserId ?? lead.ownerUserId ?? p.userId;
    await this.checkOwner(ownerUserId);
    const [row] = await this.db.current
      .insert(deals)
      .values({
        tenantId: p.tenantId,
        leadId: lead.id,
        projectId: body.projectId!,
        unitId: body.unitId ?? null,
        ownerUserId,
        ...(body.currency ? { currency: body.currency } : {}),
        offerPrice: body.offerPrice ?? null,
        offerDate: body.offerDate ?? (body.offerPrice ? await this.today() : null),
      })
      .returning()
      .catch(rethrow);
    const unit = row!.unitId ? await this.units.get(row!.unitId) : undefined;
    await this.leads.addActivity(lead.id, {
      type: 'deal',
      summary: `Deal opened${unit ? ` for unit ${unit.unitNumber}` : ''}${row!.offerPrice ? `: offer ${row!.currency} ${Number(row!.offerPrice).toLocaleString('en-US')}` : ''}`,
      actorUserId: p.userId,
      links: { dealId: row!.id },
    });
    await this.leads.recordAction(lead.id, p.userId);
    await this.audit.record('create', 'deals', row!.id, { leadId: [null, lead.id], unitId: [null, row!.unitId], stage: [null, 'offer'] });
    return row!;
  }

  /** Details only; the stage changes through changeStage. The unit can change until the deal holds it. */
  async update(p: Principal, id: string, body: DealInputDto): Promise<DealRow> {
    const before = await this.editable(p, id);
    if (before.stage === 'sold' || before.stage === 'cancelled') throw new ProblemException(409, 'CONFLICT', 'Deal closed', `The deal is ${before.stage}.`);
    if (body.leadId && body.leadId !== before.leadId) throw Problems.validation([{ field: 'leadId', message: 'a deal stays with its lead' }]);
    const projectId = body.projectId ?? before.projectId;
    const unitId = body.unitId !== undefined ? body.unitId : before.unitId;
    const moving = projectId !== before.projectId || unitId !== before.unitId;
    if (moving && HOLDING.includes(before.stage)) {
      throw Problems.validation([{ field: 'unitId', message: 'the unit cannot change after EOI; cancel the deal and open a new one' }]);
    }
    if (projectId !== before.projectId) {
      await this.projects.getProject(projectId).catch(() => {
        throw Problems.validation([{ field: 'projectId', message: 'project not found' }]);
      });
    }
    if (unitId && moving) await this.checkUnit(projectId, unitId, id);
    if (body.ownerUserId && body.ownerUserId !== before.ownerUserId) await this.checkOwner(body.ownerUserId);
    const [after] = await this.db.current
      .update(deals)
      .set({
        projectId,
        unitId,
        ...(body.ownerUserId ? { ownerUserId: body.ownerUserId } : {}),
        ...(body.currency ? { currency: body.currency } : {}),
        ...pick(body, ['offerPrice', 'offerDate', 'eoiAmount', 'eoiDate', 'bookingAmount', 'bookingDate', 'saleValue', 'saleDate']),
        updatedAt: new Date(),
      })
      .where(eq(deals.id, id))
      .returning()
      .catch(rethrow);
    await this.audit.recordUpdate('deals', id, view(before), view(after!));
    return after!;
  }

  /**
   * POST /deals/{id}/stage: EOI puts the unit On Hold, booking marks it Booked, sold marks it Sold; cancelling frees
   * the unit again. Stages only move forward. The lead timeline records each step.
   */
  async changeStage(p: Principal, id: string, body: DealStageChangeDto): Promise<DealRow> {
    const before = await this.editable(p, id);
    if (before.stage === 'sold' || before.stage === 'cancelled') throw new ProblemException(409, 'CONFLICT', 'Deal closed', `The deal is already ${before.stage}.`);
    if (body.stage !== 'cancelled' && ORDER.indexOf(body.stage) <= ORDER.indexOf(before.stage)) {
      throw Problems.validation([{ field: 'stage', message: `the deal is already at ${LABEL[before.stage]}; stages only move forward` }]);
    }
    const date = body.date ?? (await this.today());
    const errors: { field: string; message: string }[] = [];
    if (body.unitId && body.unitId !== before.unitId && HOLDING.includes(before.stage)) errors.push({ field: 'unitId', message: 'the unit cannot change after EOI' });
    const unitId = body.unitId ?? before.unitId;
    if ((body.stage === 'booking' || body.stage === 'sold') && !unitId) errors.push({ field: 'unitId', message: 'choose the unit to book' });
    if (body.stage === 'sold' && !body.amount && !before.saleValue) errors.push({ field: 'amount', message: 'the sale value is required' });
    if (body.stage === 'cancelled' && !body.cancelledReason?.trim()) errors.push({ field: 'cancelledReason', message: 'a reason is required' });
    if (errors.length) throw Problems.validation(errors);
    if (unitId && unitId !== before.unitId) await this.checkUnit(before.projectId, unitId, id);
    if (unitId && body.stage !== 'cancelled') await this.checkUnitFree(unitId, id);

    // Every stage reached on the way keeps its date (e.g. straight to booking also records the booking date only).
    const patch: Partial<typeof deals.$inferInsert> = { stage: body.stage, unitId, updatedAt: new Date() };
    if (body.stage === 'eoi') Object.assign(patch, { eoiDate: date, ...(body.amount ? { eoiAmount: body.amount } : {}) });
    if (body.stage === 'booking') Object.assign(patch, { bookingDate: date, ...(body.amount ? { bookingAmount: body.amount } : {}) });
    if (body.stage === 'sold') Object.assign(patch, { saleDate: date, saleValue: body.amount ?? before.saleValue, bookingDate: before.bookingDate ?? date });
    if (body.stage === 'cancelled') Object.assign(patch, { cancelledReason: body.cancelledReason!.trim() });

    const [after] = await this.db.current.update(deals).set(patch).where(eq(deals.id, id)).returning().catch(rethrow);
    const unit = unitId ? await this.units.get(unitId) : undefined;
    if (unit) {
      const target = UNIT_STATUS[body.stage];
      if (target) await this.units.setStatusForDeal(unit.id, target, `Deal ${LABEL[body.stage]} (lead ${after!.leadId})`, p.userId);
      // Cancelling frees the unit this deal was holding.
      else if (body.stage === 'cancelled' && HOLDING.includes(before.stage) && before.unitId === unit.id && unit.status !== 'available') {
        await this.units.setStatusForDeal(unit.id, 'available', 'Deal cancelled', p.userId);
      }
    }
    const amount = body.amount ? ` ${after!.currency} ${Number(body.amount).toLocaleString('en-US')}` : '';
    await this.leads.addActivity(after!.leadId, {
      type: body.stage === 'eoi' ? 'eoi' : body.stage === 'booking' ? 'booking' : 'deal',
      summary:
        body.stage === 'cancelled'
          ? 'Deal cancelled'
          : body.stage === 'sold'
            ? `Sold${unit ? `: unit ${unit.unitNumber}` : ''}${amount}`
            : `${LABEL[body.stage]}${unit ? ` for unit ${unit.unitNumber}` : ''}${amount}`,
      body: body.stage === 'cancelled' ? body.cancelledReason!.trim() : null,
      actorUserId: p.userId,
      links: { dealId: id },
    });
    await this.leads.recordAction(after!.leadId, p.userId);
    await this.audit.record('update', 'deals', id, { stage: [before.stage, body.stage], unitId: [before.unitId, unitId] });
    return after!;
  }

  /** Deals the principal may see (their leads), optionally for one project or agent (sales reports, dashboard). */
  async forReport(p: Principal, f: { projectId?: string; userId?: string }): Promise<DealRow[]> {
    return this.db.current
      .select()
      .from(deals)
      .where(and(await this.scope.visibleLeadIdIn(p, deals.leadId), f.projectId ? eq(deals.projectId, f.projectId) : undefined, f.userId ? eq(deals.ownerUserId, f.userId) : undefined));
  }

  /** Deals by ID for other modules (finance links, reports); no scope check. */
  async findRow(id: string): Promise<DealRow | undefined> {
    return this.find(id);
  }

  private async find(id: string): Promise<DealRow | undefined> {
    const [row] = await this.db.current.select().from(deals).where(eq(deals.id, id)).limit(1);
    return row;
  }

  private async accessible(id: string, edit: boolean): Promise<DealRow | undefined> {
    const p = RequestContext.get().principal;
    if (!p) return undefined;
    return (edit ? this.editable(p, id) : this.get(p, id)).catch(() => undefined);
  }

  private async checkUnit(projectId: string, unitId: string, dealId: string | null): Promise<void> {
    const unit = await this.units.get(unitId).catch(() => undefined);
    if (!unit || unit.projectId !== projectId) throw Problems.validation([{ field: 'unitId', message: 'unit not found in this project' }]);
    if (unit.status === 'sold' || unit.status === 'booked') await this.checkUnitFree(unitId, dealId);
  }

  /** 409 UNIT_ALREADY_BOOKED when another open deal is at EOI or later on the unit, or it is booked or sold outside a deal. */
  private async checkUnitFree(unitId: string, dealId: string | null): Promise<void> {
    const [other] = await this.db.current
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.unitId, unitId), inArray(deals.stage, HOLDING), dealId ? ne(deals.id, dealId) : undefined))
      .limit(1);
    if (other) throw unitBooked();
    const unit = await this.units.get(unitId);
    const self = dealId ? await this.find(dealId) : undefined;
    const holdingThis = !!self && self.unitId === unitId && HOLDING.includes(self.stage);
    if ((unit.status === 'booked' || unit.status === 'sold') && !holdingThis) throw unitBooked();
  }

  private async checkOwner(userId: string): Promise<void> {
    const user = await this.directory.user(userId);
    if (!user || user.status !== 'active') throw Problems.validation([{ field: 'ownerUserId', message: 'choose an active user' }]);
  }

  /** Today's date in the company's time zone (default dates of offers and stages). */
  private async today(): Promise<string> {
    const tz = (await this.organization.getProfile(this.db.currentTenantId!)).timezone;
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
}

function pick(body: DealInputDto, keys: (keyof DealInputDto)[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
}

function view(d: DealRow) {
  return { projectId: d.projectId, unitId: d.unitId, ownerUserId: d.ownerUserId, currency: d.currency, offerPrice: d.offerPrice, offerDate: d.offerDate, eoiAmount: d.eoiAmount, bookingAmount: d.bookingAmount, saleValue: d.saleValue };
}

function rethrow(err: unknown): never {
  if (pgCode(err) === PG_UNIQUE_VIOLATION) throw unitBooked();
  if (pgCode(err) === PG_FOREIGN_KEY_VIOLATION) throw Problems.validation([{ field: 'currency', message: 'unknown currency, project or unit' }]);
  throw err;
}
