'use client';

import { Alert, Button, Dialog, DialogContent, Field, Input, Select, Textarea } from '@crm/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { byId, useProjectList } from '@/core/lookups';
import { COUNTERPARTY_LABEL, DOC_TYPE_LABEL, DocType, FinanceDocument, lineTotals, money, useAllDeals, useCounterparties, useDocuments, useFinanceActions } from './finance-api';

type Line = { description: string; quantity: string; unitPrice: string; taxRate: string };
const EMPTY_LINE: Line = { description: '', quantity: '1', unitPrice: '', taxRate: '5.00' };

/**
 * New draft, edit a draft, or reissue a cancelled document as a new draft (SRS §7.1–7.4). Totals and VAT are shown
 * while typing; the server calculates the stored amounts.
 */
export function DocumentEditor({ doc, reissueOf, onClose, onSaved }: { doc?: FinanceDocument; reissueOf?: FinanceDocument; onClose: () => void; onSaved?: (d: FinanceDocument) => void }) {
  const source = doc ?? reissueOf;
  const { createDocument, updateDocument } = useFinanceActions();
  const counterparties = useCounterparties();
  const deals = useAllDeals();
  const projects = byId(useProjectList().data);
  const [docType, setDocType] = useState<DocType>(source?.docType ?? 'sales_invoice');
  const [counterpartyId, setCounterpartyId] = useState(source?.counterpartyId ?? '');
  const [dealId, setDealId] = useState(source?.dealId ?? '');
  const [purchaseOrderId, setPurchaseOrderId] = useState(source?.purchaseOrderId ?? '');
  const [issueDate, setIssueDate] = useState(doc?.issueDate ?? new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(source?.dueDate ?? '');
  const [currency, setCurrency] = useState(source?.currency ?? 'AED');
  const [paymentTerms, setPaymentTerms] = useState(source?.paymentTerms ?? '');
  const [notes, setNotes] = useState(source?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(source?.lines.map((l) => ({ description: l.description, quantity: String(Number(l.quantity)), unitPrice: String(Number(l.unitPrice)), taxRate: l.taxRate })) ?? [EMPTY_LINE]);
  const pos = useDocuments({ docType: 'purchase_order' });
  const save = doc ? updateDocument : createDocument;
  const err = (f: string) => (save.error instanceof ApiError ? save.error.fieldError(f) : undefined);
  const totals = lineTotals(lines);
  const allowed = (counterparties.data ?? []).filter((c) => (docType === 'sales_invoice' ? c.type !== 'vendor' : c.type !== 'client'));

  async function submit() {
    const body = {
      ...(doc ? {} : { docType }),
      counterpartyId,
      dealId: dealId || null,
      ...(docType === 'purchase_invoice' ? { purchaseOrderId: purchaseOrderId || null } : {}),
      issueDate,
      dueDate: dueDate || null,
      currency,
      paymentTerms: paymentTerms.trim() || null,
      notes: notes.trim() || null,
      lines: lines.map((l, i) => ({ lineNo: i + 1, description: l.description.trim(), quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate })),
    };
    const saved = await (doc ? updateDocument.mutateAsync({ id: doc.id, ...body }) : createDocument.mutateAsync(body)).catch(() => null);
    if (saved) {
      onSaved?.(saved);
      onClose();
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={doc ? `Edit draft ${DOC_TYPE_LABEL[doc.docType].toLowerCase()}` : reissueOf ? `Reissue ${reissueOf.number}` : 'New document'} wide>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Type">
              <Select value={docType} onChange={(e) => setDocType(e.target.value as DocType)} disabled={!!source}>
                {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={docType === 'sales_invoice' ? 'Bill to *' : 'Supplier *'} error={err('counterpartyId')}>
              <Select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                <option value="">Choose…</option>
                {allowed.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({COUNTERPARTY_LABEL[c.type]})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Deal (lead, project, unit)" error={err('dealId')}>
              <Select value={dealId} onChange={(e) => setDealId(e.target.value)}>
                <option value="">None</option>
                {deals.data
                  ?.filter((d) => d.stage !== 'cancelled')
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {projects.get(d.projectId)?.name ?? 'Project'} · {d.stage}
                      {d.saleValue ? ` · ${money(d.saleValue, d.currency)}` : ''}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Issue date">
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </Field>
            <Field label="Due date" error={err('dueDate')}>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Currency" error={err('currency') ?? err('rateToBase')}>
              <Input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </Field>
            {docType === 'purchase_invoice' ? (
              <Field label="Settles purchase order" error={err('purchaseOrderId')} className="sm:col-span-3">
                <Select value={purchaseOrderId} onChange={(e) => setPurchaseOrderId(e.target.value)}>
                  <option value="">None</option>
                  {pos.data?.data
                    .filter((p) => p.number && p.status !== 'cancelled')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.number} · {money(p.total, p.currency)}
                      </option>
                    ))}
                </Select>
              </Field>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <div className="grid grid-cols-[1fr_5rem_8rem_5rem_7rem_2rem] gap-2 text-xs font-medium text-muted-foreground">
              <span>Description</span>
              <span>Qty</span>
              <span>Unit price</span>
              <span>VAT %</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
            {lines.map((l, i) => {
              const set = (k: keyof Line, v: string) => setLines((x) => x.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
              return (
                <div key={i} className="grid grid-cols-[1fr_5rem_8rem_5rem_7rem_2rem] items-center gap-2">
                  <Input className="h-8" value={l.description} onChange={(e) => set('description', e.target.value)} aria-label="Description" />
                  <Input className="h-8" value={l.quantity} onChange={(e) => set('quantity', e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Quantity" />
                  <Input className="h-8" value={l.unitPrice} onChange={(e) => set('unitPrice', e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Unit price" />
                  <Input className="h-8" value={l.taxRate} onChange={(e) => set('taxRate', e.target.value.replace(/[^0-9.]/g, ''))} aria-label="VAT" />
                  <span className="text-right text-sm">{(Number(l.quantity || 0) * Number(l.unitPrice || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((x) => x.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
            <Button type="button" variant="link" size="sm" onClick={() => setLines((x) => [...x, EMPTY_LINE])}>
              <Plus /> Add line
            </Button>
            {err('lines') ? <p className="text-xs text-danger">{err('lines')}</p> : null}
            <div className="ml-auto w-64 space-y-0.5 text-sm">
              <p className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span> {money(totals.subtotal, currency)}
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">VAT</span> {money(totals.tax, currency)}
              </p>
              <p className="flex justify-between font-semibold">
                <span>Total</span> {money(totals.total, currency)}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Payment terms">
              <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="14 days" />
            </Field>
            <Field label="Notes (printed)">
              <Textarea className="min-h-9" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          {save.error && !(save.error instanceof ApiError && save.error.status === 400 && ['counterpartyId', 'dealId', 'dueDate', 'lines', 'currency', 'rateToBase', 'purchaseOrderId'].some((f) => err(f))) ? (
            <Alert>{errorMessage(save.error)}</Alert>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || !counterpartyId || lines.some((l) => !l.description.trim() || !l.unitPrice)}>
              Save draft
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
