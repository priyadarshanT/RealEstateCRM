import { billingInvoiceLines, InvoiceRow } from './billing.schema';

/** Our seller details on the tax invoice (from AWS SSM / environment in staging and production). */
const SELLER = {
  name: process.env.INVOICE_SELLER_NAME ?? 'Dubai Real Estate CRM',
  address: process.env.INVOICE_SELLER_ADDRESS ?? 'Dubai, United Arab Emirates',
  trn: process.env.INVOICE_SELLER_TRN ?? 'TRN pending',
  bank: process.env.INVOICE_BANK_DETAILS ?? 'Bank details are on the emailed invoice',
};

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const amount = (v: unknown) => Number(v).toFixed(2);

/** UAE tax invoice (SRS §12 Paying: every charge comes with a tax invoice with 5% VAT). */
export function invoiceHtml(invoice: InvoiceRow, lines: (typeof billingInvoiceLines.$inferSelect)[]): string {
  const rows = lines
    .map((l) => `<tr><td>${esc(l.description)}</td><td class="n">${l.quantity}</td><td class="n">${amount(l.unitPrice)}</td><td class="n">${amount(l.amount)}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(invoice.number)}</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;color:#222;margin:32px}h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}.n{text-align:right}.totals td{border:none}.muted{color:#666}</style></head><body>
<h1>Tax Invoice</h1><div class="muted">${esc(invoice.number)} · Issued ${esc(invoice.issueDate)} · Due ${esc(invoice.dueDate)}</div>
<table><tr><td><b>${esc(SELLER.name)}</b><br>${esc(SELLER.address)}<br>TRN: ${esc(SELLER.trn)}</td>
<td><b>Bill to</b><br>${esc(invoice.customerLegalName)}<br>${esc(invoice.customerAddress ?? '')}${invoice.customerTrn ? `<br>TRN: ${esc(invoice.customerTrn)}` : ''}</td></tr></table>
<p>Period ${esc(invoice.periodStart)} to ${esc(invoice.periodEnd)}</p>
<table><thead><tr><th>Description</th><th class="n">Users</th><th class="n">Unit price (${esc(invoice.currency)})</th><th class="n">Amount (${esc(invoice.currency)})</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals"><tr><td class="n">Subtotal</td><td class="n">${amount(invoice.subtotal)}</td></tr>
<tr><td class="n">VAT ${amount(invoice.vatRate)}%</td><td class="n">${amount(invoice.vatAmount)}</td></tr>
<tr><td class="n"><b>Total</b></td><td class="n"><b>${amount(invoice.total)} ${esc(invoice.currency)}</b></td></tr>
<tr><td class="n">Paid</td><td class="n">${amount(invoice.amountPaid)}</td></tr>
<tr><td class="n"><b>Balance due</b></td><td class="n"><b>${amount(invoice.balance)}</b></td></tr></table>
<p class="muted">Pay by card in the CRM (Billing) or by bank transfer: ${esc(SELLER.bank)}. Quote ${esc(invoice.number)} as the reference.</p>
</body></html>`;
}
