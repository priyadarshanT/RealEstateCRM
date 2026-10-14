import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, ne, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { WorkerDbService } from '../../core/database/worker-db.service';
import { pgCode, PG_UNIQUE_VIOLATION } from '../../core/errors/pg';
import { ProblemException, Problems } from '../../core/errors/problem';
import { FilesService } from '../../core/files/files.service';
import { dayAfter } from '../../core/http/dates';
import { versionConflict } from '../../core/http/etag';
import { decodeCursor, Page, toPage } from '../../core/http/pagination';
import { RequestContext } from '../../core/http/request-context';
import { MAILER, Mailer } from '../../core/mail/mailer';
import { QueueService } from '../../core/queue/queue.service';
import { DealsService } from '../deals/deals.service';
import { LeadsService } from '../leads/leads.service';
import { OrganizationService } from '../organization/organization.service';
import { ProjectsService } from '../projects/projects.service';
import { UnitsService } from '../projects/units.service';
import { SettingsService } from '../settings/settings.service';
import { DOCUMENT_PDF, DocumentPdfMaker } from './adapters/document-pdf';
import { CounterpartiesService } from './counterparties.service';
import {
  DocumentEventDto,
  FinanceDocumentDto,
  FinanceDocumentInputDto,
  FinanceDocumentListQuery,
  PaymentDto,
  PaymentInputDto,
  SendDocumentDto,
} from './dto/finance.dto';
import {
  DocEventAction,
  DocStatus,
  documentEvents,
  documentLines,
  DocumentLineRow,
  documentSequences,
  DocType,
  financeDocuments,
  FinanceDocumentRow,
  payments,
} from './finance.schema';
import { fromCents, lineAmounts, toCents } from './money';

/** Default numbering until the Admin sets finance.numbering (SRS §11.5): INV-2026-0001, PINV-2026-0001, PO-2026-0001. */
const DEFAULT_NUMBERING: Record<DocType, { prefix: string; include_year: boolean; padding: number }> = {
  sales_invoice: { prefix: 'INV-', include_year: true, padding: 4 },
  purchase_invoice: { prefix: 'PINV-', include_year: true, padding: 4 },
  purchase_order: { prefix: 'PO-', include_year: true, padding: 4 },
};
const TITLE: Record<DocType, string> = { sales_invoice: 'Tax invoice', purchase_invoice: 'Purchase invoice', purchase_order: 'Purchase order' };
const LABEL: Record<DocType, string> = { sales_invoice: 'Invoice', purchase_invoice: 'Purchase invoice', purchase_order: 'Purchase order' };

const notDraft = () => new ProblemException(422, 'NOT_DRAFT', 'Not a draft', 'Approved documents cannot be edited. Cancel and reissue.');

/**
 * Sales invoices, purchase invoices and purchase orders (SRS §7.1–7.6, §7.8): drafts are edited freely, totals are
 * calculated here; approval (finance.approve) gives the number, makes the PDF and locks the amounts; approved
 * documents are cancelled and reissued, never changed. Payments and refunds keep the balance and status right.
 * Every step is kept in the document history; documents linked to a lead show on its timeline.
 */
@Injectable()
export class DocumentsService implements OnModuleInit {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly db: DbService,
    private readonly workerDb: WorkerDbService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly files: FilesService,
    private readonly counterparties: CounterpartiesService,
    private readonly leads: LeadsService,
    private readonly projects: ProjectsService,
    private readonly units: UnitsService,
    private readonly deals: DealsService,
    private readonly organization: OrganizationService,
    private readonly settings: SettingsService,
    @Inject(DOCUMENT_PDF) private readonly pdf: DocumentPdfMaker,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  onModuleInit(): void {
    const financeUser = async (id: string) => !!RequestContext.get().principal?.permissions.has('finance.create') && !!(await this.find(id));
    this.files.registerAccess('finance_document', { canView: financeUser, canEdit: financeUser });
    this.queue.register('invoice-overdue', () => this.markOverdue(), { cron: '15 1 * * *' });
  }

  // ---------------------------------------------------------------- reading
  async list(q: FinanceDocumentListQuery): Promise<Page<FinanceDocumentDto>> {
    const after = q.cursor ? (([d, id]) => sql`(${financeDocuments.issueDate}, ${financeDocuments.id}) < (${d}::date, ${id}::uuid)`)(decodeCursor(q.cursor, 2) as [string, string]) : undefined;
    const rows = await this.db.current
      .select()
      .from(financeDocuments)
      .where(
        and(
          after,
          q.docType ? eq(financeDocuments.docType, q.docType) : undefined,
          q.status ? eq(financeDocuments.status, q.status) : undefined,
          q.counterpartyId ? eq(financeDocuments.counterpartyId, q.counterpartyId) : undefined,
          q.leadId ? eq(financeDocuments.leadId, q.leadId) : undefined,
          q.dealId ? eq(financeDocuments.dealId, q.dealId) : undefined,
          q.from ? gte(financeDocuments.issueDate, q.from) : undefined,
          q.to ? lt(financeDocuments.issueDate, dayAfter(q.to).toISOString().slice(0, 10)) : undefined,
        ),
      )
      .orderBy(desc(financeDocuments.issueDate), desc(financeDocuments.id))
      .limit(q.limit + 1);
    const lines = await this.linesOf(rows.slice(0, q.limit).map((r) => r.id));
    return toPage(rows, q.limit, (r) => [r.issueDate, r.id], (r) => FinanceDocumentDto.from(r, lines.get(r.id) ?? []));
  }

  async get(id: string): Promise<FinanceDocumentRow> {
    const row = await this.find(id);
    if (!row) throw Problems.notFound();
    return row;
  }

  async dto(row: FinanceDocumentRow): Promise<FinanceDocumentDto> {
    return FinanceDocumentDto.from(row, (await this.linesOf([row.id])).get(row.id) ?? []);
  }

  async history(id: string): Promise<DocumentEventDto[]> {
    await this.get(id);
    const rows = await this.db.current.select().from(documentEvents).where(eq(documentEvents.documentId, id)).orderBy(asc(documentEvents.createdAt), asc(documentEvents.id));
    return rows.map(DocumentEventDto.from);
  }

  async listPayments(id: string): Promise<PaymentDto[]> {
    await this.get(id);
    const rows = await this.db.current.select().from(payments).where(eq(payments.documentId, id)).orderBy(asc(payments.paidOn), asc(payments.createdAt));
    return rows.map(PaymentDto.from);
  }

  // ---------------------------------------------------------------- drafts
  async create(p: Principal, body: FinanceDocumentInputDto): Promise<FinanceDocumentRow> {
    const missing = (['docType', 'counterpartyId', 'lines'] as const).filter((f) => !body[f]);
    if (missing.length) throw Problems.validation(missing.map((field) => ({ field, message: `${field} is required` })));
    const profile = await this.organization.getProfile(p.tenantId);
    const currency = body.currency ?? profile.baseCurrency;
    const links = await this.checkLinks(body.docType!, body);
    const rateToBase = await this.rateFor(currency, profile.baseCurrency, body.rateToBase);
    const totals = calculate(body.lines!);
    const [row] = await this.db.current
      .insert(financeDocuments)
      .values({
        tenantId: p.tenantId,
        docType: body.docType!,
        counterpartyId: body.counterpartyId!,
        ...links,
        issueDate: body.issueDate ?? (await this.today()),
        dueDate: body.dueDate ?? null,
        currency,
        rateToBase,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        paymentTerms: body.paymentTerms ?? null,
        notes: body.notes ?? null,
        createdBy: p.userId,
      })
      .returning()
      .catch(rethrowDates);
    await this.writeLines(row!.id, totals.lines);
    await this.event(row!.id, 'created', null, 'draft', p.userId);
    await this.audit.record('create', 'finance_documents', row!.id, { docType: [null, row!.docType], total: [null, fromCents(totals.subtotalCents + totals.taxCents)] });
    return row!;
  }

  async update(p: Principal, id: string, body: FinanceDocumentInputDto, expectedVersion?: string): Promise<FinanceDocumentRow> {
    const before = await this.get(id);
    if (before.status !== 'draft') throw notDraft();
    if (expectedVersion !== undefined && Number(expectedVersion) !== before.version) throw versionConflict();
    if (body.docType && body.docType !== before.docType) throw Problems.validation([{ field: 'docType', message: 'the document type cannot change' }]);
    const merged = {
      counterpartyId: body.counterpartyId ?? before.counterpartyId,
      leadId: body.leadId !== undefined ? body.leadId : before.leadId,
      projectId: body.projectId !== undefined ? body.projectId : before.projectId,
      unitId: body.unitId !== undefined ? body.unitId : before.unitId,
      dealId: body.dealId !== undefined ? body.dealId : before.dealId,
      purchaseOrderId: body.purchaseOrderId !== undefined ? body.purchaseOrderId : before.purchaseOrderId,
    };
    const links = await this.checkLinks(before.docType, merged);
    const profile = await this.organization.getProfile(p.tenantId);
    const currency = body.currency ?? before.currency;
    const rateToBase = currency !== before.currency || body.rateToBase ? await this.rateFor(currency, profile.baseCurrency, body.rateToBase) : before.rateToBase;
    const totals = body.lines ? calculate(body.lines) : undefined;
    const [after] = await this.db.current
      .update(financeDocuments)
      .set({
        counterpartyId: merged.counterpartyId,
        ...links,
        ...(body.issueDate ? { issueDate: body.issueDate } : {}),
        ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
        currency,
        rateToBase,
        ...(totals ? { subtotal: totals.subtotal, taxTotal: totals.taxTotal } : {}),
        ...(body.paymentTerms !== undefined ? { paymentTerms: body.paymentTerms } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        version: before.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(financeDocuments.id, id), eq(financeDocuments.version, before.version), eq(financeDocuments.status, 'draft')))
      .returning()
      .catch(rethrowDates);
    if (!after) throw versionConflict();
    if (totals) {
      await this.db.current.delete(documentLines).where(eq(documentLines.documentId, id));
      await this.writeLines(id, totals.lines);
    }
    await this.event(id, 'edited', 'draft', 'draft', p.userId);
    await this.audit.recordUpdate('finance_documents', id, docView(before), docView(after));
    return after;
  }

  // ---------------------------------------------------------------- approval and after
  /** Approve (finance.approve): the number is given, the PDF is made and the amounts are locked. */
  async approve(p: Principal, id: string): Promise<FinanceDocumentRow> {
    const before = await this.get(id);
    if (before.status !== 'draft') throw new ProblemException(409, 'CONFLICT', 'Already approved', `The document is ${before.status}.`);
    const number = await this.nextNumber(before.docType, before.issueDate);
    const [approved] = await this.db.current
      .update(financeDocuments)
      .set({ status: 'approved', number, approvedBy: p.userId, approvedAt: new Date(), version: before.version + 1, updatedAt: new Date() })
      .where(and(eq(financeDocuments.id, id), eq(financeDocuments.status, 'draft')))
      .returning()
      .catch((err: unknown) => {
        if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ProblemException(409, 'CONFLICT', 'Number in use', `The number ${number} is already used. Check the invoice numbering settings.`);
        throw err;
      });
    if (!approved) throw versionConflict();
    await this.event(id, 'approved', 'draft', 'approved', p.userId);
    // The PDF is made now; if storage is unavailable the approval still stands and the PDF is made on first download.
    const pdf = await this.db.savepoint(() => this.makePdf(approved, p.userId));
    if (!pdf.ok) this.logger.warn(`PDF for ${number} not stored yet: ${(pdf.error as Error).message}`);
    const withPdf = pdf.ok ? pdf.value : approved;
    if (approved.leadId) {
      await this.leads.addActivity(approved.leadId, {
        type: approved.docType === 'purchase_order' ? 'purchase_order' : 'invoice',
        summary: `${LABEL[approved.docType]} ${number} approved: ${approved.currency} ${fmt(approved.total!)}`,
        actorUserId: p.userId,
        links: { financeDocumentId: id, ...(approved.dealId ? { dealId: approved.dealId } : {}) },
      });
    }
    await this.audit.record('update', 'finance_documents', id, { status: ['draft', 'approved'], number: [null, number] });
    return withPdf;
  }

  /** Send (finance.approve): emails the PDF link to the given addresses, or the counterparty's email. */
  async send(p: Principal, id: string, body: SendDocumentDto): Promise<FinanceDocumentRow> {
    let doc = await this.get(id);
    if (doc.status === 'draft' || doc.status === 'cancelled') throw new ProblemException(409, 'CONFLICT', 'Cannot send', doc.status === 'draft' ? 'Approve the document first.' : 'The document is cancelled.');
    const counterparty = await this.counterparties.get(doc.counterpartyId);
    const to = body.to?.length ? body.to : counterparty.email ? [counterparty.email] : [];
    if (!to.length) throw Problems.validation([{ field: 'to', message: 'add an email address (the counterparty has none)' }]);
    if (!doc.pdfFileId) doc = await this.makePdf(doc, p.userId);
    const link = await this.files.systemDownloadLink(doc.pdfFileId!);
    const company = await this.organization.getProfile(p.tenantId);
    for (const address of to) {
      await this.mailer.send({
        to: address,
        subject: `${TITLE[doc.docType]} ${doc.number} from ${company.legalName ?? company.name}`,
        text: [
          body.message?.trim() || `Dear ${counterparty.name},\n\nPlease find ${TITLE[doc.docType].toLowerCase()} ${doc.number} for ${doc.currency} ${fmt(doc.total!)}.`,
          `\nDownload: ${link.url}`,
          `(The link works until ${new Date(link.expiresAt).toUTCString()}.)`,
        ].join('\n'),
      });
    }
    const status: DocStatus = doc.status === 'approved' ? 'sent' : doc.status;
    const [after] = await this.db.current
      .update(financeDocuments)
      .set({ status, sentAt: new Date(), version: doc.version + 1, updatedAt: new Date() })
      .where(eq(financeDocuments.id, id))
      .returning();
    await this.event(id, 'sent', doc.status, status, p.userId, `To ${to.join(', ')}`);
    return after!;
  }

  /** Cancel (finance.approve): approved documents are cancelled with a reason and reissued as a new draft. */
  async cancel(p: Principal, id: string, reason: string): Promise<FinanceDocumentRow> {
    const before = await this.get(id);
    if (before.status === 'draft') throw new ProblemException(409, 'CONFLICT', 'Still a draft', 'A draft can simply be edited; only approved documents are cancelled.');
    if (before.status === 'cancelled') throw new ProblemException(409, 'CONFLICT', 'Already cancelled', 'The document is already cancelled.');
    if (toCents(before.amountPaid) - toCents(before.amountRefunded) !== 0n) {
      throw new ProblemException(409, 'CONFLICT', 'Payments recorded', 'Refund the payments first, then cancel.');
    }
    const [after] = await this.db.current
      .update(financeDocuments)
      .set({ status: 'cancelled', cancelledBy: p.userId, cancelledAt: new Date(), cancelReason: reason.trim(), version: before.version + 1, updatedAt: new Date() })
      .where(eq(financeDocuments.id, id))
      .returning();
    await this.event(id, 'cancelled', before.status, 'cancelled', p.userId, reason.trim());
    if (after!.leadId) {
      await this.leads.addActivity(after!.leadId, {
        type: after!.docType === 'purchase_order' ? 'purchase_order' : 'invoice',
        summary: `${LABEL[after!.docType]} ${after!.number} cancelled`,
        body: reason.trim(),
        actorUserId: p.userId,
        links: { financeDocumentId: id },
      });
    }
    await this.audit.record('update', 'finance_documents', id, { status: [before.status, 'cancelled'] });
    return after!;
  }

  /** PDF download link. Approved documents keep their PDF; a draft gets a preview marked DRAFT. */
  async pdfLink(p: Principal, id: string): Promise<{ url: string; expiresAt: string }> {
    let doc = await this.get(id);
    if (doc.status === 'draft') {
      const file = await this.storePdf(`DRAFT-${doc.docType}.pdf`, await this.pdf.render(await this.printable(doc)), p.userId);
      return this.files.downloadLink(file.id);
    }
    if (!doc.pdfFileId) doc = await this.makePdf(doc, p.userId);
    return this.files.downloadLink(doc.pdfFileId!);
  }

  // ---------------------------------------------------------------- payments
  /**
   * Payment or refund (finance.approve). The amount must fit the balance (or what was paid, for a refund) and be in
   * the document's currency. The status becomes Partially Paid, Paid or Refunded automatically.
   */
  async recordPayment(p: Principal, id: string, body: PaymentInputDto): Promise<FinanceDocumentRow> {
    const doc = await this.get(id);
    if (doc.docType === 'purchase_order') throw new ProblemException(422, 'NOT_PAYABLE', 'Purchase orders are not paid', 'Record the payment on the purchase invoice.');
    if (doc.status === 'draft' || doc.status === 'cancelled') throw new ProblemException(409, 'CONFLICT', 'Cannot record payment', doc.status === 'draft' ? 'Approve the document first.' : 'The document is cancelled.');
    if (body.currency !== doc.currency) throw new ProblemException(422, 'CURRENCY_MISMATCH', 'Currency mismatch', `Payments on this document are in ${doc.currency}.`);
    const amount = toCents(body.amount);
    if (amount <= 0n) throw Problems.validation([{ field: 'amount', message: 'must be more than zero' }]);
    const paid = toCents(doc.amountPaid);
    const refunded = toCents(doc.amountRefunded);
    const total = toCents(doc.total!);
    if (body.kind === 'payment' && amount > total - paid + refunded) {
      throw new ProblemException(422, 'AMOUNT_EXCEEDS_BALANCE', 'More than the balance', `The balance is ${doc.currency} ${fmt(doc.balance!)}.`);
    }
    if (body.kind === 'refund' && amount > paid - refunded) {
      throw new ProblemException(422, 'AMOUNT_EXCEEDS_BALANCE', 'More than was paid', `Only ${doc.currency} ${fromCents(paid - refunded)} can be refunded.`);
    }
    const [payment] = await this.db.current
      .insert(payments)
      .values({
        tenantId: p.tenantId,
        documentId: id,
        kind: body.kind,
        amount: fromCents(amount),
        currency: body.currency,
        paidOn: body.paidOn,
        method: body.method,
        reference: body.reference ?? null,
        notes: body.notes ?? null,
        proofFileId: body.proofFileId ?? null,
        recordedBy: p.userId,
      })
      .returning()
      .catch((err: unknown) => {
        if (pgCode(err) === '23503') throw Problems.validation([{ field: 'proofFileId', message: 'file not found' }]);
        throw err;
      });
    const newPaid = body.kind === 'payment' ? paid + amount : paid;
    const newRefunded = body.kind === 'refund' ? refunded + amount : refunded;
    const status = statusAfterMoney(doc, total, newPaid - newRefunded, newRefunded, await this.today());
    const [after] = await this.db.current
      .update(financeDocuments)
      .set({ amountPaid: fromCents(newPaid), amountRefunded: fromCents(newRefunded), status, version: doc.version + 1, updatedAt: new Date() })
      .where(eq(financeDocuments.id, id))
      .returning();
    await this.event(id, body.kind === 'payment' ? 'payment_recorded' : 'refund_recorded', doc.status, status, p.userId, `${doc.currency} ${fromCents(amount)} by ${body.method.replace('_', ' ')}${body.reference ? ` (${body.reference})` : ''}`, payment!.id);
    if (doc.leadId) {
      await this.leads.addActivity(doc.leadId, {
        type: 'payment',
        summary: `${body.kind === 'payment' ? 'Payment' : 'Refund'} ${doc.currency} ${fmt(fromCents(amount))} on ${doc.number}; balance ${doc.currency} ${fmt(after!.balance!)}`,
        actorUserId: p.userId,
        links: { financeDocumentId: id, paymentId: payment!.id },
      });
    }
    await this.audit.record('create', 'payments', payment!.id, { documentId: [null, id], kind: [null, body.kind], amount: [null, fromCents(amount)] });
    return after!;
  }

  // ---------------------------------------------------------------- jobs
  /** invoice-overdue (daily): unpaid invoices past their due date become Overdue. */
  async markOverdue(): Promise<void> {
    const tenants = await this.workerDb.db
      .selectDistinct({ tenantId: financeDocuments.tenantId })
      .from(financeDocuments)
      .where(and(inArray(financeDocuments.status, ['approved', 'sent', 'partially_paid']), isNotNull(financeDocuments.dueDate), ne(financeDocuments.docType, 'purchase_order')));
    for (const { tenantId } of tenants) {
      try {
        await this.db.withTenant(tenantId, async () => {
          const today = await this.today();
          const late = await this.db.current
            .update(financeDocuments)
            .set({ status: 'overdue', updatedAt: new Date() })
            .where(and(inArray(financeDocuments.status, ['approved', 'sent', 'partially_paid']), lt(financeDocuments.dueDate, today), sql`${financeDocuments.balance} > 0`, ne(financeDocuments.docType, 'purchase_order')))
            .returning({ id: financeDocuments.id });
          for (const d of late) await this.event(d.id, 'overdue', null, 'overdue', null);
        });
      } catch (err) {
        this.logger.error(`overdue check for tenant ${tenantId} failed: ${(err as Error).message}`);
      }
    }
  }

  /** Approved documents issued in a period (invoices report). */
  async forReport(from?: string, to?: string): Promise<FinanceDocumentRow[]> {
    return this.db.current
      .select()
      .from(financeDocuments)
      .where(and(ne(financeDocuments.status, 'draft'), from ? gte(financeDocuments.issueDate, from) : undefined, to ? lte(financeDocuments.issueDate, to) : undefined))
      .orderBy(asc(financeDocuments.issueDate), asc(financeDocuments.number));
  }

  /** Payments and refunds received in a period, with their document (payments report). */
  async paymentsForReport(from?: string, to?: string) {
    return this.db.current
      .select({ p: payments, number: financeDocuments.number, docType: financeDocuments.docType, counterpartyId: financeDocuments.counterpartyId })
      .from(payments)
      .innerJoin(financeDocuments, eq(financeDocuments.id, payments.documentId))
      .where(and(from ? gte(payments.paidOn, from) : undefined, to ? lte(payments.paidOn, to) : undefined))
      .orderBy(asc(payments.paidOn), asc(payments.createdAt));
  }

  /** What clients and developers still owe on sales invoices, in the base currency (dashboard card). */
  async unpaidSalesBalance(): Promise<string> {
    const [row] = await this.db.current
      .select({ total: sql<string>`coalesce(sum(${financeDocuments.balance} * ${financeDocuments.rateToBase}), 0)::numeric(14,2)::text` })
      .from(financeDocuments)
      .where(and(eq(financeDocuments.docType, 'sales_invoice'), inArray(financeDocuments.status, ['approved', 'sent', 'partially_paid', 'overdue'])));
    return Number(row?.total ?? 0).toFixed(2);
  }

  /** Approved sales invoices to a developer (commission invoices) for other modules. */
  async findRow(id: string): Promise<FinanceDocumentRow | undefined> {
    return this.find(id);
  }

  // ---------------------------------------------------------------- helpers
  private async find(id: string): Promise<FinanceDocumentRow | undefined> {
    const [row] = await this.db.current.select().from(financeDocuments).where(eq(financeDocuments.id, id)).limit(1);
    return row;
  }

  private async linesOf(ids: string[]): Promise<Map<string, DocumentLineRow[]>> {
    if (!ids.length) return new Map();
    const rows = await this.db.current.select().from(documentLines).where(inArray(documentLines.documentId, ids)).orderBy(asc(documentLines.lineNo));
    const out = new Map<string, DocumentLineRow[]>();
    for (const r of rows) out.set(r.documentId, [...(out.get(r.documentId) ?? []), r]);
    return out;
  }

  private async writeLines(documentId: string, lines: ReturnType<typeof calculate>['lines']): Promise<void> {
    await this.db.current.insert(documentLines).values(lines.map((l) => ({ ...l, tenantId: this.db.currentTenantId!, documentId })));
  }

  /**
   * Links: counterparty fits the type; a deal fills its lead, project and unit; a unit must be in the project; a
   * purchase invoice may settle an open purchase order.
   */
  private async checkLinks(docType: DocType, body: Partial<Record<'counterpartyId' | 'leadId' | 'projectId' | 'unitId' | 'dealId' | 'purchaseOrderId', string | null | undefined>>) {
    const errors: { field: string; message: string }[] = [];
    const counterparty = body.counterpartyId ? await this.counterparties.get(body.counterpartyId).catch(() => undefined) : undefined;
    if (!counterparty) errors.push({ field: 'counterpartyId', message: 'counterparty not found' });
    else if (docType === 'sales_invoice' ? counterparty.type === 'vendor' : counterparty.type === 'client') {
      errors.push({ field: 'counterpartyId', message: docType === 'sales_invoice' ? 'a sales invoice goes to a client or a developer' : 'purchases are from a vendor or a developer' });
    }
    let leadId = body.leadId ?? null;
    let projectId = body.projectId ?? null;
    let unitId = body.unitId ?? null;
    const dealId = body.dealId ?? null;
    if (dealId) {
      const deal = await this.deals.findRow(dealId);
      if (!deal) errors.push({ field: 'dealId', message: 'deal not found' });
      else {
        if (leadId && leadId !== deal.leadId) errors.push({ field: 'leadId', message: 'does not match the deal' });
        leadId = deal.leadId;
        projectId ??= deal.projectId;
        unitId ??= deal.unitId;
      }
    }
    if (leadId && !body.dealId) {
      const lead = await this.leads.findRow(leadId);
      if (!lead || lead.deletedAt) errors.push({ field: 'leadId', message: 'lead not found' });
    }
    if (unitId) {
      const unit = await this.units.get(unitId).catch(() => undefined);
      if (!unit) errors.push({ field: 'unitId', message: 'unit not found' });
      else if (projectId && unit.projectId !== projectId) errors.push({ field: 'unitId', message: 'the unit is not in this project' });
      else projectId ??= unit.projectId;
    }
    if (projectId && !unitId) await this.projects.getProject(projectId).catch(() => errors.push({ field: 'projectId', message: 'project not found' }));
    const purchaseOrderId = body.purchaseOrderId ?? null;
    if (purchaseOrderId) {
      const po = await this.find(purchaseOrderId);
      if (docType !== 'purchase_invoice') errors.push({ field: 'purchaseOrderId', message: 'only a purchase invoice settles a purchase order' });
      else if (!po || po.docType !== 'purchase_order' || po.status === 'cancelled' || po.status === 'draft') errors.push({ field: 'purchaseOrderId', message: 'choose an approved purchase order' });
    }
    if (errors.length) throw Problems.validation(errors);
    return { leadId, projectId, unitId, dealId, purchaseOrderId };
  }

  private async rateFor(currency: string, base: string, given?: string): Promise<string> {
    if (currency === base) return '1';
    const enabled = (await this.settings.listCurrencies()).find((c) => c.code === currency);
    if (!enabled) throw Problems.validation([{ field: 'currency', message: `${currency} is not enabled in Settings` }]);
    const rate = given ?? enabled.rateToBase;
    if (!rate || Number(rate) <= 0) throw Problems.validation([{ field: 'rateToBase', message: `enter the rate from ${currency} to ${base}` }]);
    return rate;
  }

  /** Next number in the document's sequence (numbering setting, restarting each year when the year is shown). */
  private async nextNumber(docType: DocType, issueDate: string): Promise<string> {
    const format = (await this.settings.find('finance.numbering'))?.[docType] ?? DEFAULT_NUMBERING[docType];
    const year = Number(issueDate.slice(0, 4));
    const tenantId = this.db.currentTenantId!;
    await this.db.current
      .insert(documentSequences)
      .values({ tenantId, docType, prefix: format.prefix, includeYear: format.include_year, padding: format.padding, currentYear: year, nextNumber: 1 })
      .onConflictDoNothing();
    const [seq] = await this.db.current
      .select()
      .from(documentSequences)
      .where(and(eq(documentSequences.tenantId, tenantId), eq(documentSequences.docType, docType)))
      .for('update');
    const n = format.include_year && seq!.currentYear !== year ? 1 : seq!.nextNumber;
    await this.db.current
      .update(documentSequences)
      .set({ prefix: format.prefix, includeYear: format.include_year, padding: format.padding, currentYear: format.include_year ? year : seq!.currentYear, nextNumber: n + 1 })
      .where(and(eq(documentSequences.tenantId, tenantId), eq(documentSequences.docType, docType)));
    return `${format.prefix}${format.include_year ? `${year}-` : ''}${String(n).padStart(format.padding, '0')}`;
  }

  private async makePdf(doc: FinanceDocumentRow, userId: string | null): Promise<FinanceDocumentRow> {
    const body = await this.pdf.render(await this.printable(doc));
    const file = await this.storePdf(`${doc.number}.pdf`, body, userId);
    const [after] = await this.db.current.update(financeDocuments).set({ pdfFileId: file.id }).where(eq(financeDocuments.id, doc.id)).returning();
    await this.event(doc.id, 'pdf_generated', null, null, userId);
    return after!;
  }

  /** Stores a PDF; when file storage is not set up yet the caller gets 503 instead of a server error. */
  private async storePdf(fileName: string, body: Buffer, userId: string | null) {
    try {
      return await this.files.store(fileName, 'application/pdf', body, 'finance', userId ?? undefined);
    } catch (err) {
      if (/not configured/i.test((err as Error).message)) {
        throw new ProblemException(503, 'STORAGE_UNAVAILABLE', 'File storage unavailable', 'PDF files cannot be stored yet (file storage is not set up).');
      }
      throw err;
    }
  }

  private async printable(doc: FinanceDocumentRow) {
    const [company, counterparty, lines] = await Promise.all([
      this.organization.getProfile(doc.tenantId),
      this.counterparties.get(doc.counterpartyId),
      this.linesOf([doc.id]).then((m) => m.get(doc.id) ?? []),
    ]);
    const unit = doc.unitId ? await this.units.get(doc.unitId).catch(() => undefined) : undefined;
    const project = doc.projectId ? (await this.projects.names([doc.projectId])).get(doc.projectId) : undefined;
    const po = doc.purchaseOrderId ? await this.find(doc.purchaseOrderId) : undefined;
    return {
      title: TITLE[doc.docType],
      number: doc.number ?? 'DRAFT',
      company: { name: company.legalName ?? company.name, trn: company.trn, address: company.address },
      counterparty: { name: counterparty.name, trn: counterparty.trn, address: counterparty.address, email: counterparty.email },
      issueDate: doc.issueDate,
      dueDate: doc.dueDate,
      currency: doc.currency,
      lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, lineSubtotal: l.lineSubtotal, taxAmount: l.taxAmount })),
      subtotal: doc.subtotal,
      taxTotal: doc.taxTotal,
      total: fromCents(toCents(doc.subtotal) + toCents(doc.taxTotal)),
      paymentTerms: doc.paymentTerms,
      notes: doc.notes,
      references: [project ? `Project: ${project}` : null, unit ? `Unit: ${unit.unitNumber}` : null, po?.number ? `PO: ${po.number}` : null].filter((x): x is string => !!x),
    };
  }

  private async event(documentId: string, action: DocEventAction, fromStatus: string | null, toStatus: string | null, actorUserId: string | null, note?: string, paymentId?: string): Promise<void> {
    // clock_timestamp(): several events of one request keep their order (now() is the same for the whole transaction).
    await this.db.current.insert(documentEvents).values({ tenantId: this.db.currentTenantId!, documentId, action, fromStatus, toStatus, actorUserId, note: note ?? null, paymentId: paymentId ?? null, createdAt: sql`clock_timestamp()` });
  }

  private async today(): Promise<string> {
    const tz = (await this.organization.getProfile(this.db.currentTenantId!)).timezone;
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
}

/** Line amounts and document totals, to the cent. */
function calculate(lines: { lineNo: number; description: string; quantity: string; unitPrice: string; taxRate: string }[]) {
  const numbers = new Set<number>();
  for (const l of lines) {
    if (numbers.has(l.lineNo)) throw Problems.validation([{ field: 'lines', message: `line number ${l.lineNo} is used twice` }]);
    if (Number(l.quantity) <= 0) throw Problems.validation([{ field: 'lines', message: `line ${l.lineNo}: quantity must be more than zero` }]);
    if (Number(l.taxRate) > 100) throw Problems.validation([{ field: 'lines', message: `line ${l.lineNo}: VAT rate is a percent` }]);
    numbers.add(l.lineNo);
  }
  let subtotalCents = 0n;
  let taxCents = 0n;
  const out = [...lines]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((l) => {
      const { subtotal, tax } = lineAmounts(l.quantity, l.unitPrice, l.taxRate);
      subtotalCents += subtotal;
      taxCents += tax;
      return { lineNo: l.lineNo, description: l.description.trim(), quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, lineSubtotal: fromCents(subtotal), taxAmount: fromCents(tax) };
    });
  return { lines: out, subtotal: fromCents(subtotalCents), taxTotal: fromCents(taxCents), subtotalCents, taxCents };
}

/** Status from the money received: Paid, Partially Paid, Refunded; Overdue stays while past due and unpaid. */
function statusAfterMoney(doc: FinanceDocumentRow, total: bigint, net: bigint, refunded: bigint, today: string): DocStatus {
  if (net >= total && total > 0n) return 'paid';
  if (net <= 0n && refunded > 0n) return 'refunded';
  const late = !!doc.dueDate && doc.dueDate < today;
  if (net > 0n) return late ? 'overdue' : 'partially_paid';
  return late ? 'overdue' : doc.sentAt ? 'sent' : 'approved';
}

function fmt(amount: string): string {
  return Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function docView(d: FinanceDocumentRow) {
  return { counterpartyId: d.counterpartyId, leadId: d.leadId, dealId: d.dealId, issueDate: d.issueDate, dueDate: d.dueDate, currency: d.currency, subtotal: d.subtotal, taxTotal: d.taxTotal };
}

function rethrowDates(err: unknown): never {
  if (pgCode(err) === '23514') throw Problems.validation([{ field: 'dueDate', message: 'must be on or after the issue date' }]);
  if (pgCode(err) === '23503') throw Problems.validation([{ field: 'currency', message: 'unknown currency or linked record' }]);
  throw err;
}

