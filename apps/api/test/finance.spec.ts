import { INestApplication } from '@nestjs/common';
import { QueueService } from '../src/core/queue/queue.service';
import { MAILER, MemoryMailer } from '../src/core/mail/mailer';
import { createTestApp, ownerQuery, signIn, TENANT_B, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

// Tenant B has free seats for the extra users this file needs (tenant A has all 4 paid seats in use).
const FINANCE = { id: 'b0000000-0000-0000-0000-0000000000f1', email: 'finance.spec@b.ae', tenant: TENANT_B };
const AGENT = { id: 'b0000000-0000-0000-0000-0000000000f3', email: 'finance.agent@b.ae', tenant: TENANT_B };

// Invoices and purchase orders (SRS §7) in tenant B with a Finance user: counterparties, drafts with VAT totals,
// approval with numbering and PDF, send, payments and refunds, cancel, purchase orders, overdue, commissions.
describe('finance', () => {
  let app: INestApplication;
  const mail = new MemoryMailer();
  let finance: Client;
  let admin: Client;
  let ali: Client;
  let clientId: string;
  let developerCp: string;
  let vendorId: string;
  let invoiceId: string;
  let dealId: string;
  let developerId: string;
  let AHMED: string;
  const year = new Date().getFullYear();

  beforeAll(async () => {
    app = await createTestApp((b) => b.overrideProvider(MAILER).useValue(mail));
    for (const [u, role, name] of [[FINANCE, 'finance', 'Fatima Finance'], [AGENT, 'sales_agent', 'Omar Agent']] as const) {
      await ownerQuery(
        `INSERT INTO users (id, tenant_id, email, full_name, role_id, status)
         SELECT $1, $2, $3, $4, id, 'active' FROM roles WHERE tenant_id = $2 AND key = $5 ON CONFLICT (id) DO NOTHING`,
        [u.id, TENANT_B, u.email, name, role],
      );
    }
    finance = await signIn(app, FINANCE);
    admin = await signIn(app, USERS.adminB);
    ali = await signIn(app, AGENT);
    const sourceId = (await admin.get('/api/v1/lead-sources?limit=100').expect(200)).body.data[0].id;
    AHMED = (await admin.post('/api/v1/leads').send({ fullName: 'Ahmed', phonePrimary: '+971507880001', sourceId, ownerUserId: AGENT.id }).expect(201)).body.id;
    developerId = (await admin.post('/api/v1/developers').send({ name: 'Finance Spec Developer', trn: '100200300400003' }).expect(201)).body.id;
    const projectId = (await admin.post('/api/v1/projects').send({ developerId, name: 'Finance Spec Residences' }).expect(201)).body.id;
    const unitId = (await admin.post('/api/v1/units').send({ projectId, unitNumber: '701', propertyType: 'apartment', bedrooms: 1, sizeSqft: 800, price: '1500000' }).expect(201)).body.id;
    dealId = (await ali.post('/api/v1/deals').send({ leadId: AHMED, projectId, unitId }).expect(201)).body.id;
    await ali.post(`/api/v1/deals/${dealId}/stage`).send({ stage: 'sold', amount: '1500000' }).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('only finance users see finance; counterparties prefill from the lead or developer', async () => {
    await ali.get('/api/v1/finance-documents').expect(403);
    await admin.get('/api/v1/counterparties').expect(403);
    const client = await finance.post('/api/v1/counterparties').send({ type: 'client', leadId: AHMED, email: 'ahmed@example.ae', address: 'Dubai Marina' }).expect(201);
    expect(client.body).toMatchObject({ type: 'client', name: 'Ahmed', leadId: AHMED, email: 'ahmed@example.ae' });
    clientId = client.body.id;
    await finance.post('/api/v1/counterparties').send({ type: 'developer', name: 'X' }).expect(400);
    const dev = await finance.post('/api/v1/counterparties').send({ type: 'developer', developerId }).expect(201);
    expect(dev.body).toMatchObject({ name: 'Finance Spec Developer', trn: '100200300400003', developerId });
    developerCp = dev.body.id;
    vendorId = (await finance.post('/api/v1/counterparties').send({ type: 'vendor', name: 'PrintCo LLC' }).expect(201)).body.id;
    await finance.post('/api/v1/counterparties').send({ type: 'vendor', name: 'Bad', leadId: AHMED }).expect(400);
    const found = await finance.get('/api/v1/counterparties?type=vendor&q=print').expect(200);
    expect(found.body.data.map((c: { id: string }) => c.id)).toEqual([vendorId]);
  });

  it('a draft invoice gets server totals with VAT to the cent; drafts can change; stale versions are refused', async () => {
    await finance.post('/api/v1/finance-documents').send({ docType: 'sales_invoice', counterpartyId: vendorId, lines: [{ lineNo: 1, description: 'x', quantity: '1', unitPrice: '1', taxRate: '5' }] }).expect(400);
    const draft = await finance
      .post('/api/v1/finance-documents')
      .send({
        docType: 'sales_invoice',
        counterpartyId: clientId,
        dealId,
        issueDate: `${year}-10-14`,
        dueDate: `${year}-10-28`,
        lines: [
          { lineNo: 1, description: 'Booking fee', quantity: '1', unitPrice: '100000', taxRate: '5' },
          { lineNo: 2, description: 'Admin fee', quantity: '2.5', unitPrice: '1999.99', taxRate: '5.00' },
        ],
        paymentTerms: '14 days',
      })
      .expect(201);
    expect(draft.body).toMatchObject({ status: 'draft', number: null, currency: 'AED', leadId: AHMED, subtotal: '104999.98', taxTotal: '5250.00', total: '110249.98', balance: '110249.98', version: 1 });
    expect(draft.body.lines[1]).toMatchObject({ quantity: '2.500', lineSubtotal: '4999.98', taxAmount: '250.00' });
    invoiceId = draft.body.id;
    const etag = draft.headers.etag!;
    const edited = await finance.patch(`/api/v1/finance-documents/${invoiceId}`).set('If-Match', etag).send({ lines: [{ lineNo: 1, description: 'Booking fee', quantity: '1', unitPrice: '100000', taxRate: '5' }] }).expect(200);
    expect(edited.body).toMatchObject({ total: '105000.00', version: 2 });
    await finance.patch(`/api/v1/finance-documents/${invoiceId}`).set('If-Match', etag).send({ notes: 'late' }).expect(409);
    await finance.patch(`/api/v1/finance-documents/${invoiceId}`).send({ dueDate: `${year - 1}-01-01` }).expect(400);
  });

  it('approval gives the number and the PDF, locks the document and shows on the lead timeline', async () => {
    await ali.post(`/api/v1/finance-documents/${invoiceId}/approve`).expect(403);
    const approved = await finance.post(`/api/v1/finance-documents/${invoiceId}/approve`).expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', number: `INV-${year}-0001`, pdfFileId: expect.any(String) });
    await finance.post(`/api/v1/finance-documents/${invoiceId}/approve`).expect(409);
    const locked = await finance.patch(`/api/v1/finance-documents/${invoiceId}`).send({ notes: 'change' }).expect(422);
    expect(locked.body.code).toBe('NOT_DRAFT');
    const pdf = await finance.get(`/api/v1/finance-documents/${invoiceId}/pdf`).expect(200);
    expect(pdf.body.url).toEqual(expect.any(String));
    const timeline = (await ali.get(`/api/v1/leads/${AHMED}/timeline?limit=50`).expect(200)).body.data.map((a: { summary: string }) => a.summary);
    expect(timeline).toContain(`Invoice INV-${year}-0001 approved: AED 105,000.00`);
  });

  it('send emails the PDF link to the client and marks the invoice Sent', async () => {
    const sent = await finance.post(`/api/v1/finance-documents/${invoiceId}/send`).send({}).expect(200);
    expect(sent.body.status).toBe('sent');
    expect(mail.last('ahmed@example.ae')?.subject).toBe(`Tax invoice INV-${year}-0001 from Other Brokerage`);
  });

  it('payments and refunds keep the balance and status; limits and currency are checked', async () => {
    const pay = (body: object) => finance.post(`/api/v1/finance-documents/${invoiceId}/payments`).send({ kind: 'payment', currency: 'AED', paidOn: `${year}-10-15`, method: 'bank_transfer', ...body });
    expect((await pay({ amount: '10', currency: 'USD' }).expect(422)).body.code).toBe('CURRENCY_MISMATCH');
    expect((await pay({ amount: '105000.01' }).expect(422)).body.code).toBe('AMOUNT_EXCEEDS_BALANCE');
    await ali.post(`/api/v1/finance-documents/${invoiceId}/payments`).send({ kind: 'payment', amount: '1', currency: 'AED', paidOn: `${year}-10-15`, method: 'cash' }).expect(403);
    const part = await pay({ amount: '50000', reference: 'TT-1' }).expect(201);
    expect(part.body).toMatchObject({ status: 'partially_paid', amountPaid: '50000.00', balance: '55000.00' });
    const full = await pay({ amount: '55000', method: 'cheque' }).expect(201);
    expect(full.body).toMatchObject({ status: 'paid', balance: '0.00' });
    await finance.post(`/api/v1/finance-documents/${invoiceId}/cancel`).send({ reason: 'Wrong client' }).expect(409); // paid
    expect((await pay({ kind: 'refund', amount: '105000.01' }).expect(422)).body.code).toBe('AMOUNT_EXCEEDS_BALANCE');
    const refunded = await pay({ kind: 'refund', amount: '105000' }).expect(201);
    expect(refunded.body).toMatchObject({ status: 'refunded', amountRefunded: '105000.00', balance: '105000.00' });
    const payments = (await finance.get(`/api/v1/finance-documents/${invoiceId}/payments`).expect(200)).body.data;
    expect(payments.map((x: { kind: string; amount: string }) => `${x.kind} ${x.amount}`)).toEqual(['payment 50000.00', 'payment 55000.00', 'refund 105000.00']);

    const cancelled = await finance.post(`/api/v1/finance-documents/${invoiceId}/cancel`).send({ reason: 'Deal reversed' }).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    const history = (await finance.get(`/api/v1/finance-documents/${invoiceId}/history`).expect(200)).body.data.map((e: { action: string }) => e.action);
    expect(history).toEqual(['created', 'edited', 'approved', 'pdf_generated', 'sent', 'payment_recorded', 'payment_recorded', 'refund_recorded', 'cancelled']);
  });

  it('purchase orders are numbered on their own, are not paid, and purchase invoices settle them', async () => {
    const po = (await finance.post('/api/v1/finance-documents').send({ docType: 'purchase_order', counterpartyId: vendorId, lines: [{ lineNo: 1, description: 'Brochures', quantity: '1000', unitPrice: '2.5', taxRate: '5' }] }).expect(201)).body;
    await finance.post('/api/v1/finance-documents').send({ docType: 'purchase_invoice', counterpartyId: vendorId, purchaseOrderId: po.id, lines: [{ lineNo: 1, description: 'x', quantity: '1', unitPrice: '1', taxRate: '5' }] }).expect(400); // PO still draft
    const approvedPo = await finance.post(`/api/v1/finance-documents/${po.id}/approve`).expect(200);
    expect(approvedPo.body.number).toBe(`PO-${year}-0001`);
    const payPo = await finance.post(`/api/v1/finance-documents/${po.id}/payments`).send({ kind: 'payment', amount: '1', currency: 'AED', paidOn: `${year}-10-15`, method: 'cash' }).expect(422);
    expect(payPo.body.code).toBe('NOT_PAYABLE');
    const pi = await finance.post('/api/v1/finance-documents').send({ docType: 'purchase_invoice', counterpartyId: vendorId, purchaseOrderId: po.id, lines: [{ lineNo: 1, description: 'Brochures', quantity: '1000', unitPrice: '2.5', taxRate: '5' }] }).expect(201);
    expect(pi.body).toMatchObject({ purchaseOrderId: po.id, total: '2625.00' });
    await finance.post('/api/v1/finance-documents').send({ docType: 'purchase_order', counterpartyId: clientId, lines: [{ lineNo: 1, description: 'x', quantity: '1', unitPrice: '1', taxRate: '5' }] }).expect(400);
  });

  it('numbering follows the finance.numbering setting; unpaid invoices past due become Overdue', async () => {
    const numbering = { prefix: 'ANR-', include_year: false, padding: 5 };
    // Settings are changed by an Admin (settings.manage).
    await admin.put('/api/v1/settings/finance.numbering').send({ value: { sales_invoice: numbering, purchase_invoice: { prefix: 'PINV-', include_year: true, padding: 4 }, purchase_order: { prefix: 'PO-', include_year: true, padding: 4 } } }).expect(200);
    const doc = (await finance.post('/api/v1/finance-documents').send({ docType: 'sales_invoice', counterpartyId: developerCp, issueDate: `${year - 1}-01-10`, dueDate: `${year - 1}-02-10`, lines: [{ lineNo: 1, description: 'Commission', quantity: '1', unitPrice: '30000', taxRate: '5' }] }).expect(201)).body;
    const approved = await finance.post(`/api/v1/finance-documents/${doc.id}/approve`).expect(200);
    expect(approved.body.number).toMatch(/^ANR-\d{5}$/);
    await app.get(QueueService).runNow('invoice-overdue');
    expect((await finance.get(`/api/v1/finance-documents/${doc.id}`).expect(200)).body.status).toBe('overdue');
    const listed = await finance.get(`/api/v1/finance-documents?status=overdue&from=${year - 1}-01-01&to=${year - 1}-01-31`).expect(200);
    expect(listed.body.data.map((d: { id: string }) => d.id)).toEqual([doc.id]);
    const late = await finance.post(`/api/v1/finance-documents/${doc.id}/payments`).send({ kind: 'payment', amount: '10000', currency: 'AED', paidOn: `${year}-10-15`, method: 'bank_transfer' }).expect(201);
    expect(late.body.status).toBe('overdue'); // still past due with a balance
    await admin.put('/api/v1/settings/finance.numbering').send({ value: { sales_invoice: { prefix: 'INV-', include_year: true, padding: 4 }, purchase_invoice: { prefix: 'PINV-', include_year: true, padding: 4 }, purchase_order: { prefix: 'PO-', include_year: true, padding: 4 } } }).expect(200);
    // The commission invoice to the developer is used below.
    (globalThis as { devInvoice?: string }).devInvoice = doc.id;
  });

  it('commissions: percentage of the sale value or fixed, approved then paid by finance', async () => {
    const pct = await finance.post('/api/v1/commissions').send({ dealId, userId: AGENT.id, basis: 'percentage', rate: '2.5', developerInvoiceId: (globalThis as { devInvoice?: string }).devInvoice }).expect(201);
    expect(pct.body).toMatchObject({ basis: 'percentage', rate: '2.5', amount: '37500.00', currency: 'AED', status: 'pending' });
    await finance.post('/api/v1/commissions').send({ dealId, userId: AGENT.id, basis: 'fixed', amount: '1000' }).expect(409);
    await finance.post('/api/v1/commissions').send({ dealId, userId: USERS.adminB.id, basis: 'fixed' }).expect(400);
    await finance.post('/api/v1/commissions').send({ dealId, userId: USERS.adminB.id, basis: 'fixed', amount: '5000', developerInvoiceId: invoiceId }).expect(400); // invoice to a client
    const fixed = await finance.post('/api/v1/commissions').send({ dealId, userId: USERS.adminB.id, basis: 'fixed', amount: '5000' }).expect(201);
    await finance.post(`/api/v1/commissions/${fixed.body.id}/mark-paid`).send({ paidOn: `${year}-11-01` }).expect(409);
    await finance.post(`/api/v1/commissions/${fixed.body.id}/approve`).expect(200);
    const paid = await finance.post(`/api/v1/commissions/${fixed.body.id}/mark-paid`).send({ paidOn: `${year}-11-01` }).expect(200);
    expect(paid.body).toMatchObject({ status: 'paid', paidOn: `${year}-11-01` });
    const list = await finance.get(`/api/v1/commissions?dealId=${dealId}`).expect(200);
    expect(list.body.data).toHaveLength(2);
  });
});
