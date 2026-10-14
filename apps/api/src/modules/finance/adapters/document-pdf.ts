import { Logger } from '@nestjs/common';

/** What is printed on a financial document PDF. */
export interface PrintableDocument {
  title: string;
  number: string;
  company: { name: string; trn?: string | null; address?: string | null };
  counterparty: { name: string; trn?: string | null; address?: string | null; email?: string | null };
  issueDate: string;
  dueDate: string | null;
  currency: string;
  lines: { description: string; quantity: string; unitPrice: string; taxRate: string; lineSubtotal: string; taxAmount: string }[];
  subtotal: string;
  taxTotal: string;
  total: string;
  paymentTerms: string | null;
  notes: string | null;
  references: string[];
}

/**
 * PDF of an invoice or purchase order (SRS §7.5). One adapter: Gotenberg (architecture §2) renders the HTML layout;
 * when Gotenberg is not reachable (e.g. local development before Docker is set up) a plain built-in PDF with the
 * same content is produced, so every document can always be downloaded.
 */
export interface DocumentPdfMaker {
  render(doc: PrintableDocument): Promise<Buffer>;
}
export const DOCUMENT_PDF = Symbol('DOCUMENT_PDF');

export class GotenbergDocumentPdf implements DocumentPdfMaker {
  private readonly logger = new Logger('DocumentPdf');

  constructor(private readonly url: string) {}

  async render(doc: PrintableDocument): Promise<Buffer> {
    try {
      const form = new FormData();
      form.append('files', new Blob([documentHtml(doc)], { type: 'text/html' }), 'index.html');
      const res = await fetch(`${this.url}/forms/chromium/convert/html`, { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`Gotenberg ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      this.logger.warn(`Gotenberg not available (${(err as Error).message}); using the plain PDF layout`);
      return plainPdf(documentText(doc));
    }
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (s: string) => Number(s).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function documentHtml(d: PrintableDocument): string {
  const rows = d.lines
    .map((l) => `<tr><td>${esc(l.description)}</td><td class="r">${Number(l.quantity)}</td><td class="r">${num(l.unitPrice)}</td><td class="r">${Number(l.taxRate)}%</td><td class="r">${num(l.taxAmount)}</td><td class="r">${num(l.lineSubtotal)}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#111;margin:40px}h1{font-size:20px;margin:0}
table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}.r{text-align:right}
.grid{display:flex;justify-content:space-between;margin-top:16px}.tot td{border:none}
</style></head><body>
<h1>${esc(d.title)} ${esc(d.number)}</h1>
<div class="grid"><div><b>${esc(d.company.name)}</b><br>${d.company.trn ? `TRN ${esc(d.company.trn)}<br>` : ''}${esc(d.company.address ?? '')}</div>
<div><b>${esc(d.counterparty.name)}</b><br>${d.counterparty.trn ? `TRN ${esc(d.counterparty.trn)}<br>` : ''}${esc(d.counterparty.address ?? '')}</div>
<div>Issue date: ${d.issueDate}<br>${d.dueDate ? `Due date: ${d.dueDate}<br>` : ''}Currency: ${d.currency}</div></div>
${d.references.length ? `<p>${d.references.map(esc).join(' · ')}</p>` : ''}
<table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">VAT</th><th class="r">VAT amount</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="tot"><tr><td class="r">Subtotal</td><td class="r" style="width:140px">${num(d.subtotal)}</td></tr><tr><td class="r">VAT</td><td class="r">${num(d.taxTotal)}</td></tr><tr><td class="r"><b>Total ${d.currency}</b></td><td class="r"><b>${num(d.total)}</b></td></tr></table>
${d.paymentTerms ? `<p><b>Payment terms:</b> ${esc(d.paymentTerms)}</p>` : ''}${d.notes ? `<p>${esc(d.notes)}</p>` : ''}
</body></html>`;
}

export function documentText(d: PrintableDocument): string[] {
  return [
    `${d.title} ${d.number}`,
    '',
    `${d.company.name}${d.company.trn ? `  TRN ${d.company.trn}` : ''}`,
    ...(d.company.address ? [d.company.address] : []),
    '',
    `Bill to: ${d.counterparty.name}${d.counterparty.trn ? `  TRN ${d.counterparty.trn}` : ''}`,
    ...(d.counterparty.address ? [d.counterparty.address] : []),
    '',
    `Issue date: ${d.issueDate}${d.dueDate ? `   Due date: ${d.dueDate}` : ''}   Currency: ${d.currency}`,
    ...(d.references.length ? [d.references.join(' | ')] : []),
    '',
    ...d.lines.map((l) => `${l.description} | qty ${Number(l.quantity)} x ${num(l.unitPrice)} | VAT ${Number(l.taxRate)}% ${num(l.taxAmount)} | ${num(l.lineSubtotal)}`),
    '',
    `Subtotal: ${num(d.subtotal)}`,
    `VAT: ${num(d.taxTotal)}`,
    `Total ${d.currency}: ${num(d.total)}`,
    ...(d.paymentTerms ? ['', `Payment terms: ${d.paymentTerms}`] : []),
    ...(d.notes ? ['', d.notes] : []),
  ];
}

/** A minimal valid one-page-per-55-lines PDF (Helvetica, A4) with the given text lines. */
export function plainPdf(lines: string[]): Buffer {
  const clean = lines.map((l) => l.replace(/[^\x20-\x7E]/g, '?').replace(/([\\()])/g, '\\$1'));
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(clean.length, 1); i += 55) pages.push(clean.slice(i, i + 55));
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((page, i) => {
    const stream = `BT /F1 10 Tf 50 800 Td 14 TL ${page.map((l) => `(${l}) Tj T*`).join(' ')} ET`;
    objects[pageIds[i]!] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`;
    objects[pageIds[i]! + 1] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out);
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
