import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { pgCode, PG_UNIQUE_VIOLATION } from '../../core/errors/pg';
import { ProblemException, Problems } from '../../core/errors/problem';
import { FilesService } from '../../core/files/files.service';
import { decodeCursor, Page, toPage } from '../../core/http/pagination';
import { RequestContext } from '../../core/http/request-context';
import { DealsService } from '../deals/deals.service';
import { OrganizationDirectory } from '../organization/directory.service';
import { CounterpartiesService } from './counterparties.service';
import { DocumentsService } from './documents.service';
import { CommissionDto, CommissionInputDto, CommissionListQuery } from './dto/finance.dto';
import { CommissionRow, commissions } from './finance.schema';
import { fromCents, percentOf } from './money';

/**
 * Agent commissions per deal (SRS §7.7): a percentage of the sale value or a fixed amount, with the developer
 * commission invoice attached. Finance approves and marks them paid (finance.approve); every change is logged.
 */
@Injectable()
export class CommissionsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly deals: DealsService,
    private readonly documents: DocumentsService,
    private readonly counterparties: CounterpartiesService,
    private readonly directory: OrganizationDirectory,
  ) {}

  onModuleInit(): void {
    const financeUser = async (id: string) => !!RequestContext.get().principal?.permissions.has('finance.create') && !!(await this.find(id));
    this.files.registerAccess('commission', { canView: financeUser, canEdit: financeUser });
  }

  async list(q: CommissionListQuery): Promise<Page<CommissionDto>> {
    const after = q.cursor ? (([at, id]) => sql`(${commissions.createdAt}, ${commissions.id}) < (${at}::timestamptz, ${id}::uuid)`)(decodeCursor(q.cursor, 2) as [string, string]) : undefined;
    const rows = await this.db.current
      .select()
      .from(commissions)
      .where(and(after, q.userId ? eq(commissions.userId, q.userId) : undefined, q.dealId ? eq(commissions.dealId, q.dealId) : undefined, q.status ? eq(commissions.status, q.status) : undefined))
      .orderBy(desc(commissions.createdAt), desc(commissions.id))
      .limit(q.limit + 1);
    return toPage(rows, q.limit, (r) => [r.createdAt.toISOString(), r.id], CommissionDto.from);
  }

  async get(id: string): Promise<CommissionRow> {
    const row = await this.find(id);
    if (!row) throw Problems.notFound();
    return row;
  }

  async create(body: CommissionInputDto): Promise<CommissionRow> {
    const errors: { field: string; message: string }[] = [];
    const deal = await this.deals.findRow(body.dealId);
    if (!deal) errors.push({ field: 'dealId', message: 'deal not found' });
    else if (deal.stage === 'cancelled') errors.push({ field: 'dealId', message: 'the deal is cancelled' });
    const agent = await this.directory.user(body.userId);
    if (!agent) errors.push({ field: 'userId', message: 'user not found' });
    let amount: string | undefined = body.amount;
    if (body.basis === 'percentage') {
      if (!body.rate) errors.push({ field: 'rate', message: 'the percentage is required' });
      else if (deal && !deal.saleValue) errors.push({ field: 'rate', message: 'the deal has no sale value yet; use a fixed amount' });
      else if (deal) amount = fromCents(percentOf(deal.saleValue!, body.rate));
    } else {
      if (body.rate) errors.push({ field: 'rate', message: 'only for percentage commissions' });
      if (!amount) errors.push({ field: 'amount', message: 'the amount is required' });
    }
    if (body.developerInvoiceId) errors.push(...(await this.checkDeveloperInvoice(body.developerInvoiceId)));
    if (errors.length) throw Problems.validation(errors);
    const [row] = await this.db.current
      .insert(commissions)
      .values({
        tenantId: this.db.currentTenantId!,
        dealId: body.dealId,
        userId: body.userId,
        basis: body.basis,
        rate: body.basis === 'percentage' ? body.rate! : null,
        amount: amount!,
        currency: body.currency ?? deal!.currency,
        developerInvoiceId: body.developerInvoiceId ?? null,
        notes: body.notes ?? null,
      })
      .returning()
      .catch((err: unknown) => {
        if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ProblemException(409, 'CONFLICT', 'Already exists', 'This agent already has a commission on this deal.');
        throw err;
      });
    await this.audit.record('create', 'commissions', row!.id, { dealId: [null, row!.dealId], userId: [null, row!.userId], amount: [null, row!.amount] });
    return row!;
  }

  async approve(p: Principal, id: string): Promise<CommissionRow> {
    const before = await this.get(id);
    if (before.status !== 'pending') throw new ProblemException(409, 'CONFLICT', 'Not pending', `The commission is ${before.status}.`);
    const [after] = await this.db.current
      .update(commissions)
      .set({ status: 'approved', approvedBy: p.userId, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(commissions.id, id))
      .returning();
    await this.audit.record('update', 'commissions', id, { status: ['pending', 'approved'] });
    return after!;
  }

  async markPaid(id: string, paidOn: string): Promise<CommissionRow> {
    const before = await this.get(id);
    if (before.status !== 'approved') throw new ProblemException(409, 'CONFLICT', 'Not approved', before.status === 'pending' ? 'Approve the commission first.' : `The commission is ${before.status}.`);
    const [after] = await this.db.current.update(commissions).set({ status: 'paid', paidOn, updatedAt: new Date() }).where(eq(commissions.id, id)).returning();
    await this.audit.record('update', 'commissions', id, { status: ['approved', 'paid'], paidOn: [null, paidOn] });
    return after!;
  }

  /** Every commission (commissions report); cancelled ones are left out. */
  async forReport(): Promise<CommissionRow[]> {
    return this.db.current.select().from(commissions).where(ne(commissions.status, 'cancelled'));
  }

  private async find(id: string): Promise<CommissionRow | undefined> {
    const [row] = await this.db.current.select().from(commissions).where(eq(commissions.id, id)).limit(1);
    return row;
  }

  /** The developer commission invoice is a sales invoice to a developer. */
  private async checkDeveloperInvoice(id: string): Promise<{ field: string; message: string }[]> {
    const doc = await this.documents.findRow(id);
    if (!doc || doc.docType !== 'sales_invoice') return [{ field: 'developerInvoiceId', message: 'choose a sales invoice' }];
    const counterparty = await this.counterparties.get(doc.counterpartyId);
    return counterparty.type === 'developer' ? [] : [{ field: 'developerInvoiceId', message: 'the invoice must be to a developer' }];
  }
}
