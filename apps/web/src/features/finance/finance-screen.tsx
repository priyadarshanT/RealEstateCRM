'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Field, Input, Loading, Select, StatCard, TabStrip, Table, Td, Th, Tr } from '@crm/ui';
import { Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { formatDate } from '@/core/format';
import { byId, useColleagues, useProjectList } from '@/core/lookups';
import { useCan } from '@/core/session';
import { useDevelopers } from '@/features/projects/projects-api';
import { DocumentDialog } from './document-dialog';
import { DocumentEditor } from './document-editor';
import {
  Counterparty,
  COUNTERPARTY_LABEL,
  DOC_STATUS_LABEL,
  DOC_STATUS_TONE,
  DOC_TYPE_LABEL,
  DocFilters,
  DocStatus,
  DocType,
  money,
  useAllDeals,
  useCommissions,
  useCounterparties,
  useDocuments,
  useFinanceActions,
} from './finance-api';

const TABS = [
  { key: 'documents', label: 'Invoices & POs' },
  { key: 'counterparties', label: 'Clients, developers & vendors' },
  { key: 'commissions', label: 'Commissions' },
];

/** Invoices and purchase orders (SRS §7): documents, who they are with, and agent commissions. */
export function FinanceScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab')! : 'documents';
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Invoices & Purchase Orders</h1>
      <TabStrip items={TABS} value={tab} onChange={(k) => router.replace(`/finance?tab=${k}`)} />
      {tab === 'documents' ? <Documents /> : null}
      {tab === 'counterparties' ? <Counterparties /> : null}
      {tab === 'commissions' ? <Commissions /> : null}
    </div>
  );
}

function Documents() {
  const [filters, setFilters] = useState<DocFilters>({});
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const docs = useDocuments(filters);
  const parties = byId(useCounterparties().data);
  const set = (k: keyof DocFilters, v: string) => setFilters((f) => ({ ...f, [k]: v || undefined }));
  const rows = docs.data?.data ?? [];
  const unpaid = rows.filter((d) => ['approved', 'sent', 'partially_paid', 'overdue'].includes(d.status) && d.docType === 'sales_invoice');
  const sum = (list: typeof rows, k: 'balance' | 'total') => list.reduce((n, d) => n + Number(d[k]), 0);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Unpaid sales invoices" value={unpaid.length} />
        <StatCard label="Balance due (AED)" value={sum(unpaid.filter((d) => d.currency === 'AED'), 'balance').toLocaleString('en-US', { maximumFractionDigits: 0 })} />
        <StatCard label="Overdue" value={rows.filter((d) => d.status === 'overdue').length} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select className="h-8 w-auto text-xs" value={filters.docType ?? ''} onChange={(e) => set('docType', e.target.value as DocType)} aria-label="Type">
          <option value="">All types</option>
          {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select className="h-8 w-auto text-xs" value={filters.status ?? ''} onChange={(e) => set('status', e.target.value as DocStatus)} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(DOC_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Input type="date" className="h-8 w-auto text-xs" value={filters.from ?? ''} onChange={(e) => set('from', e.target.value)} aria-label="Issued from" />
        <Input type="date" className="h-8 w-auto text-xs" value={filters.to ?? ''} onChange={(e) => set('to', e.target.value)} aria-label="Issued to" />
        <span className="ml-auto" />
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> New document
        </Button>
      </div>
      {docs.error ? <Alert>{errorMessage(docs.error)}</Alert> : null}
      {docs.isLoading ? <Loading /> : null}
      <Table>
        <thead>
          <tr>
            <Th>Number</Th>
            <Th>Type</Th>
            <Th>With</Th>
            <Th>Issued</Th>
            <Th>Due</Th>
            <Th>Total</Th>
            <Th>Balance</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <Tr key={d.id} className="cursor-pointer" onClick={() => setOpen(d.id)}>
              <Td className="font-medium">{d.number ?? 'Draft'}</Td>
              <Td className="text-xs">{DOC_TYPE_LABEL[d.docType]}</Td>
              <Td>{parties.get(d.counterpartyId)?.name ?? '—'}</Td>
              <Td className="text-xs">{formatDate(d.issueDate, 'UTC')}</Td>
              <Td className="text-xs">{d.dueDate ? formatDate(d.dueDate, 'UTC') : '—'}</Td>
              <Td className="whitespace-nowrap">{money(d.total, d.currency)}</Td>
              <Td className="whitespace-nowrap">{d.docType === 'purchase_order' ? '—' : money(d.balance, d.currency)}</Td>
              <Td>
                <Badge tone={DOC_STATUS_TONE[d.status]}>{DOC_STATUS_LABEL[d.status]}</Badge>
              </Td>
            </Tr>
          ))}
          {rows.length === 0 && !docs.isLoading ? (
            <tr>
              <Td colSpan={8} className="text-center text-muted-foreground">
                No documents match.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
      {open ? <DocumentDialog id={open} onClose={() => setOpen(null)} /> : null}
      {creating ? <DocumentEditor onClose={() => setCreating(false)} onSaved={(d) => setOpen(d.id)} /> : null}
    </div>
  );
}

function Counterparties() {
  const [type, setType] = useState<Counterparty['type'] | ''>('');
  const list = useCounterparties(type || undefined);
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select className="h-8 w-auto text-xs" value={type} onChange={(e) => setType(e.target.value as Counterparty['type'] | '')} aria-label="Type">
          <option value="">All</option>
          {Object.entries(COUNTERPARTY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <span className="ml-auto" />
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> Add
        </Button>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Type</Th>
            <Th>TRN</Th>
            <Th>Email</Th>
            <Th>Phone</Th>
          </tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((c) => (
            <Tr key={c.id}>
              <Td className="font-medium">{c.name}</Td>
              <Td>{COUNTERPARTY_LABEL[c.type]}</Td>
              <Td className="text-xs">{c.trn ?? '—'}</Td>
              <Td className="text-xs">{c.email ?? '—'}</Td>
              <Td className="text-xs">{c.phone ?? '—'}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {creating ? <CounterpartyDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function CounterpartyDialog({ onClose }: { onClose: () => void }) {
  const { createCounterparty } = useFinanceActions();
  const developers = useDevelopers();
  const [type, setType] = useState<Counterparty['type']>('client');
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const err = (k: string) => (createCounterparty.error instanceof ApiError ? createCounterparty.error.fieldError(k) : undefined);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Add a client, developer or vendor">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = { type, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])) };
            if (await createCounterparty.mutateAsync(body).catch(() => null)) onClose();
          }}
        >
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as Counterparty['type'])}>
              {Object.entries(COUNTERPARTY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          {type === 'developer' ? (
            <Field label="Developer *" error={err('developerId')}>
              <Select value={f.developerId ?? ''} onChange={set('developerId')}>
                <option value="">Choose…</option>
                {developers.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Name *" error={err('name')}>
              <Input value={f.name ?? ''} onChange={set('name')} />
            </Field>
          )}
          <Field label="VAT number (TRN)">
            <Input value={f.trn ?? ''} onChange={set('trn')} />
          </Field>
          <Field label="Billing email" error={err('email')}>
            <Input type="email" value={f.email ?? ''} onChange={set('email')} />
          </Field>
          <Field label="Phone" error={err('phone')}>
            <Input value={f.phone ?? ''} onChange={set('phone')} placeholder="+971 50 123 4567" />
          </Field>
          <Field label="Address">
            <Input value={f.address ?? ''} onChange={set('address')} />
          </Field>
          {createCounterparty.error && !(createCounterparty.error instanceof ApiError && createCounterparty.error.status === 400) ? <Alert className="sm:col-span-2">{errorMessage(createCounterparty.error)}</Alert> : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createCounterparty.isPending}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const COMMISSION_TONE = { pending: 'warning', approved: 'primary', paid: 'success', cancelled: 'neutral' } as const;

function Commissions() {
  const can = useCan();
  const list = useCommissions();
  const deals = byId(useAllDeals().data);
  const projects = byId(useProjectList().data);
  const people = byId(useColleagues().data);
  const a = useFinanceActions();
  const [creating, setCreating] = useState(false);
  const error = a.approveCommission.error ?? a.markPaid.error;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> New commission
        </Button>
      </div>
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      <Table>
        <thead>
          <tr>
            <Th>Agent</Th>
            <Th>Deal</Th>
            <Th>Basis</Th>
            <Th>Amount</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((c) => {
            const deal = deals.get(c.dealId);
            return (
              <Tr key={c.id}>
                <Td>{people.get(c.userId)?.fullName ?? '—'}</Td>
                <Td className="text-xs">{deal ? `${projects.get(deal.projectId)?.name ?? 'Project'} · ${deal.stage}` : '—'}</Td>
                <Td className="text-xs">{c.basis === 'percentage' ? `${c.rate}% of sale` : 'Fixed'}</Td>
                <Td>{money(c.amount, c.currency)}</Td>
                <Td>
                  <Badge tone={COMMISSION_TONE[c.status]}>{c.status}</Badge>
                  {c.paidOn ? <span className="ml-1 text-xs text-muted-foreground">{formatDate(c.paidOn, 'UTC')}</span> : null}
                </Td>
                <Td className="whitespace-nowrap">
                  {can('finance.approve') && c.status === 'pending' ? (
                    <Button variant="link" size="sm" onClick={() => a.approveCommission.mutate(c.id)}>
                      Approve
                    </Button>
                  ) : null}
                  {can('finance.approve') && c.status === 'approved' ? (
                    <Button variant="link" size="sm" onClick={() => a.markPaid.mutate({ id: c.id, paidOn: new Date().toISOString().slice(0, 10) })}>
                      Mark paid today
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            );
          })}
          {list.data?.length === 0 ? (
            <tr>
              <Td colSpan={6} className="text-center text-muted-foreground">
                No commissions yet.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
      {creating ? <CommissionDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function CommissionDialog({ onClose }: { onClose: () => void }) {
  const { createCommission } = useFinanceActions();
  const deals = useAllDeals();
  const projects = byId(useProjectList().data);
  const people = useColleagues();
  const devInvoices = useDocuments({ docType: 'sales_invoice' });
  const devParties = byId(useCounterparties('developer').data);
  const [dealId, setDealId] = useState('');
  const [userId, setUserId] = useState('');
  const [basis, setBasis] = useState<'percentage' | 'fixed'>('percentage');
  const [rate, setRate] = useState('2');
  const [amount, setAmount] = useState('');
  const [invoice, setInvoice] = useState('');
  const err = (k: string) => (createCommission.error instanceof ApiError ? createCommission.error.fieldError(k) : undefined);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New commission">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await createCommission
              .mutateAsync({ dealId, userId, basis, ...(basis === 'percentage' ? { rate } : { amount }), ...(invoice ? { developerInvoiceId: invoice } : {}) })
              .catch(() => null);
            if (ok) onClose();
          }}
        >
          <Field label="Deal *" error={err('dealId')} className="sm:col-span-2">
            <Select value={dealId} onChange={(e) => setDealId(e.target.value)}>
              <option value="">Choose…</option>
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
          <Field label="Agent *" error={err('userId')}>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Choose…</option>
              {people.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Basis">
            <Select value={basis} onChange={(e) => setBasis(e.target.value as 'percentage' | 'fixed')}>
              <option value="percentage">% of sale value</option>
              <option value="fixed">Fixed amount</option>
            </Select>
          </Field>
          {basis === 'percentage' ? (
            <Field label="Rate (%)" error={err('rate')}>
              <Input value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ''))} />
            </Field>
          ) : (
            <Field label="Amount" error={err('amount')}>
              <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
            </Field>
          )}
          <Field label="Developer commission invoice" error={err('developerInvoiceId')}>
            <Select value={invoice} onChange={(e) => setInvoice(e.target.value)}>
              <option value="">None yet</option>
              {devInvoices.data?.data
                .filter((d) => devParties.has(d.counterpartyId) && d.status !== 'cancelled')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.number ?? 'Draft'} · {devParties.get(d.counterpartyId)?.name} · {money(d.total, d.currency)}
                  </option>
                ))}
            </Select>
          </Field>
          {createCommission.error && !(createCommission.error instanceof ApiError && createCommission.error.status === 400) ? <Alert className="sm:col-span-2">{errorMessage(createCommission.error)}</Alert> : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!dealId || !userId || createCommission.isPending}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
