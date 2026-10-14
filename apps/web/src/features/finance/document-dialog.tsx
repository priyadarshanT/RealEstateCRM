'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Field, Input, Loading, Select, TabStrip, Table, Td, Th, Tr } from '@crm/ui';
import { Download, Upload } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { openDownload, uploadFile } from '@/core/files';
import { formatDate, formatDateTime } from '@/core/format';
import { byId, useUsers } from '@/core/lookups';
import { useCan } from '@/core/session';
import { DocumentEditor } from './document-editor';
import {
  DOC_STATUS_LABEL,
  DOC_STATUS_TONE,
  DOC_TYPE_LABEL,
  FinanceDocument,
  money,
  useCounterparties,
  useDocument,
  useDocumentFiles,
  useDocumentHistory,
  useDocumentPayments,
  useFinanceActions,
} from './finance-api';

type Tab = 'lines' | 'payments' | 'history' | 'files';
type Action = 'send' | 'pay' | 'refund' | 'cancel' | null;

/**
 * One invoice or purchase order (SRS §7.2–7.8): drafts are edited; approval (Finance / Director) gives the number
 * and PDF; then send, payments and refunds, or cancel and reissue. History and files are kept.
 */
export function DocumentDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const can = useCan();
  const doc = useDocument(id);
  const parties = byId(useCounterparties().data);
  const a = useFinanceActions();
  const [tab, setTab] = useState<Tab>('lines');
  const [action, setAction] = useState<Action>(null);
  const [editing, setEditing] = useState(false);
  const [reissue, setReissue] = useState<FinanceDocument | null>(null);
  const [pdfError, setPdfError] = useState<unknown>(null);
  const d = doc.data;
  const approver = can('finance.approve');
  const error = a.approve.error ?? a.send.error ?? a.cancel.error ?? a.pay.error;

  async function pdf() {
    setPdfError(null);
    try {
      const link = unwrap(await api.GET('/finance-documents/{id}/pdf', { params: { path: { id } } }));
      window.open(link.url, '_blank', 'noopener');
    } catch (err) {
      setPdfError(err);
    }
  }

  if (editing && d) return <DocumentEditor doc={d} onClose={() => setEditing(false)} />;
  if (reissue) return <DocumentEditor reissueOf={reissue} onClose={() => (setReissue(null), onClose())} />;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={d ? `${DOC_TYPE_LABEL[d.docType]} ${d.number ?? '(draft)'}` : 'Document'} wide>
        {doc.isLoading ? <Loading /> : null}
        {d ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={DOC_STATUS_TONE[d.status]}>{DOC_STATUS_LABEL[d.status]}</Badge>
              <span>{parties.get(d.counterpartyId)?.name ?? '—'}</span>
              <span className="text-muted-foreground">
                Issued {formatDate(d.issueDate, 'UTC')}
                {d.dueDate ? ` · due ${formatDate(d.dueDate, 'UTC')}` : ''}
              </span>
              <span className="ml-auto" />
              <Button size="sm" variant="outline" onClick={() => void pdf()}>
                <Download /> PDF
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <Amount label="Total" value={money(d.total, d.currency)} />
              <Amount label="Paid" value={money(d.amountPaid, d.currency)} />
              <Amount label="Refunded" value={money(d.amountRefunded, d.currency)} />
              <Amount label="Balance" value={money(d.balance, d.currency)} strong />
            </div>

            <div className="flex flex-wrap gap-2">
              {d.status === 'draft' ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    Edit draft
                  </Button>
                  {approver ? (
                    <Button size="sm" disabled={a.approve.isPending} onClick={() => a.approve.mutate(d.id)}>
                      Approve
                    </Button>
                  ) : (
                    <span className="self-center text-xs text-muted-foreground">Waiting for Finance / Director approval</span>
                  )}
                </>
              ) : null}
              {approver && d.status !== 'draft' && d.status !== 'cancelled' ? (
                <>
                  <Button size="sm" variant={action === 'send' ? 'primary' : 'outline'} onClick={() => setAction('send')}>
                    Send
                  </Button>
                  {d.docType !== 'purchase_order' ? (
                    <>
                      <Button size="sm" variant={action === 'pay' ? 'primary' : 'outline'} onClick={() => setAction('pay')} disabled={Number(d.balance) <= 0}>
                        Record payment
                      </Button>
                      <Button size="sm" variant={action === 'refund' ? 'primary' : 'outline'} onClick={() => setAction('refund')} disabled={Number(d.amountPaid) - Number(d.amountRefunded) <= 0}>
                        Record refund
                      </Button>
                    </>
                  ) : null}
                  <Button size="sm" variant={action === 'cancel' ? 'danger' : 'outline'} onClick={() => setAction('cancel')}>
                    Cancel
                  </Button>
                </>
              ) : null}
              {d.status === 'cancelled' && can('finance.create') ? (
                <Button size="sm" variant="outline" onClick={() => setReissue(d)}>
                  Reissue as new draft
                </Button>
              ) : null}
            </div>
            {action === 'send' ? <SendForm doc={d} email={parties.get(d.counterpartyId)?.email ?? ''} onDone={() => setAction(null)} /> : null}
            {action === 'pay' || action === 'refund' ? <PaymentForm doc={d} kind={action === 'pay' ? 'payment' : 'refund'} onDone={() => setAction(null)} /> : null}
            {action === 'cancel' ? <CancelForm doc={d} onDone={(reissueNow) => (setAction(null), reissueNow ? setReissue(d) : undefined)} /> : null}
            {error ? <Alert>{errorMessage(error)}</Alert> : null}
            {pdfError ? <Alert>{errorMessage(pdfError)}</Alert> : null}

            <TabStrip
              items={[
                { key: 'lines', label: 'Lines' },
                { key: 'payments', label: 'Payments' },
                { key: 'history', label: 'History' },
                { key: 'files', label: 'Files' },
              ]}
              value={tab}
              onChange={(k) => setTab(k as Tab)}
            />
            {tab === 'lines' ? <Lines doc={d} /> : null}
            {tab === 'payments' ? <Payments id={d.id} /> : null}
            {tab === 'history' ? <History id={d.id} /> : null}
            {tab === 'files' ? <Files id={d.id} /> : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Amount({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={strong ? 'font-semibold' : undefined}>{value}</p>
    </div>
  );
}

function Lines({ doc }: { doc: FinanceDocument }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Description</Th>
          <Th>Qty</Th>
          <Th>Unit price</Th>
          <Th>VAT</Th>
          <Th>Amount</Th>
        </tr>
      </thead>
      <tbody>
        {doc.lines.map((l) => (
          <Tr key={l.lineNo}>
            <Td>{l.description}</Td>
            <Td>{Number(l.quantity)}</Td>
            <Td>{money(l.unitPrice, doc.currency)}</Td>
            <Td className="text-xs">
              {Number(l.taxRate)}% · {money(l.taxAmount, doc.currency)}
            </Td>
            <Td>{money(l.lineSubtotal, doc.currency)}</Td>
          </Tr>
        ))}
        <Tr>
          <Td colSpan={4} className="text-right text-muted-foreground">
            Subtotal · VAT
          </Td>
          <Td>
            {money(doc.subtotal, doc.currency)} · {money(doc.taxTotal, doc.currency)}
          </Td>
        </Tr>
      </tbody>
    </Table>
  );
}

function SendForm({ doc, email, onDone }: { doc: FinanceDocument; email: string; onDone: () => void }) {
  const { send } = useFinanceActions();
  const [to, setTo] = useState(email);
  const [message, setMessage] = useState('');
  return (
    <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="To (comma separated)">
        <Input value={to} onChange={(e) => setTo(e.target.value)} />
      </Field>
      <Field label="Message">
        <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional" />
      </Field>
      <Button
        size="sm"
        disabled={send.isPending}
        onClick={async () => {
          const ok = await send.mutateAsync({ id: doc.id, to: to.split(',').map((x) => x.trim()).filter(Boolean), message: message.trim() }).catch(() => null);
          if (ok) onDone();
        }}
      >
        Send
      </Button>
    </div>
  );
}

function PaymentForm({ doc, kind, onDone }: { doc: FinanceDocument; kind: 'payment' | 'refund'; onDone: () => void }) {
  const { pay } = useFinanceActions();
  const max = kind === 'payment' ? Number(doc.balance) : Number(doc.amountPaid) - Number(doc.amountRefunded);
  const [amount, setAmount] = useState(max.toFixed(2));
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<'bank_transfer' | 'cheque' | 'card' | 'cash' | 'other'>('bank_transfer');
  const [reference, setReference] = useState('');
  return (
    <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-5 sm:items-end">
      <Field label={`${kind === 'payment' ? 'Amount' : 'Refund'} (${doc.currency})`}>
        <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
      </Field>
      <Field label="Date">
        <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </Field>
      <Field label="Method">
        <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option value="bank_transfer">Bank transfer</option>
          <option value="cheque">Cheque</option>
          <option value="card">Card</option>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </Select>
      </Field>
      <Field label="Reference">
        <Input value={reference} onChange={(e) => setReference(e.target.value)} />
      </Field>
      <Button
        size="sm"
        disabled={pay.isPending || !Number(amount)}
        onClick={async () => {
          const ok = await pay.mutateAsync({ id: doc.id, kind, amount: Number(amount).toFixed(2), currency: doc.currency, paidOn, method, ...(reference.trim() ? { reference: reference.trim() } : {}) }).catch(() => null);
          if (ok) onDone();
        }}
      >
        Save
      </Button>
    </div>
  );
}

function CancelForm({ doc, onDone }: { doc: FinanceDocument; onDone: (reissue: boolean) => void }) {
  const { cancel } = useFinanceActions();
  const [reason, setReason] = useState('');
  const run = async (reissue: boolean) => {
    const ok = await cancel.mutateAsync({ id: doc.id, reason: reason.trim() }).catch(() => null);
    if (ok) onDone(reissue);
  };
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <Field label="Reason * (approved documents are never changed: cancel and reissue)">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" disabled={reason.trim().length < 3 || cancel.isPending} onClick={() => void run(false)}>
          Cancel document
        </Button>
        <Button size="sm" variant="danger" disabled={reason.trim().length < 3 || cancel.isPending} onClick={() => void run(true)}>
          Cancel and reissue
        </Button>
      </div>
    </div>
  );
}

function Payments({ id }: { id: string }) {
  const payments = useDocumentPayments(id);
  return (
    <Table>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Kind</Th>
          <Th>Amount</Th>
          <Th>Method</Th>
          <Th>Reference</Th>
        </tr>
      </thead>
      <tbody>
        {(payments.data ?? []).map((p) => (
          <Tr key={p.id}>
            <Td className="text-xs">{formatDate(p.paidOn, 'UTC')}</Td>
            <Td>{p.kind === 'payment' ? 'Payment' : 'Refund'}</Td>
            <Td>{money(p.amount, p.currency)}</Td>
            <Td className="text-xs">{p.method.replace('_', ' ')}</Td>
            <Td className="text-xs">{p.reference ?? '—'}</Td>
          </Tr>
        ))}
        {payments.data?.length === 0 ? (
          <tr>
            <Td colSpan={5} className="text-center text-muted-foreground">
              No payments yet.
            </Td>
          </tr>
        ) : null}
      </tbody>
    </Table>
  );
}

const ACTION_LABEL: Record<string, string> = {
  created: 'Created',
  edited: 'Edited',
  approved: 'Approved',
  sent: 'Sent',
  payment_recorded: 'Payment recorded',
  refund_recorded: 'Refund recorded',
  overdue: 'Became overdue',
  cancelled: 'Cancelled',
  pdf_generated: 'PDF made',
};

function History({ id }: { id: string }) {
  const history = useDocumentHistory(id);
  const users = byId(useUsers().data);
  return (
    <Table>
      <tbody>
        {(history.data ?? []).map((e, i) => (
          <Tr key={i}>
            <Td className="whitespace-nowrap text-xs">{formatDateTime(e.createdAt)}</Td>
            <Td>{ACTION_LABEL[e.action] ?? e.action}</Td>
            <Td className="text-xs text-muted-foreground">{e.note ?? ''}</Td>
            <Td className="text-xs">{e.actorUserId ? (users.get(e.actorUserId)?.fullName ?? '—') : 'System'}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

function Files({ id }: { id: string }) {
  const files = useDocumentFiles(id);
  const { attach } = useFinanceActions();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function add(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fileId = await uploadFile(file, 'finance');
      await attach.mutateAsync({ id, fileId, category: 'receipt' });
      await files.refetch();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
        <Upload className="size-4" /> {busy ? 'Uploading…' : 'Add file (receipt, signed copy…)'}
        <input type="file" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && void add(e.target.files[0])} />
      </label>
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      <Table>
        <tbody>
          {(files.data ?? []).map((f) => (
            <Tr key={f.id}>
              <Td>{f.fileName ?? f.fileId}</Td>
              <Td className="text-xs">{f.createdAt ? formatDate(f.createdAt) : ''}</Td>
              <Td>
                <Button variant="ghost" size="sm" onClick={() => void openDownload(f.fileId)}>
                  <Download /> Open
                </Button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
