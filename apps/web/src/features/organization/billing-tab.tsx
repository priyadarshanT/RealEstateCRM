'use client';

import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, DialogContent, Field, Input, Loading, Select, Table, Td, Th, Tr } from '@crm/ui';
import { useState } from 'react';
import { errorMessage } from '@/core/api';
import { formatDate, formatDateTime, formatMoney } from '@/core/format';
import { useCan } from '@/core/session';
import { useBillingMutations, useHistory, useInvoices, usePayments, usePlans, useSubscription, type Subscription } from './billing-api';

const STATUS: Record<Subscription['status'], { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' }> = {
  trialing: { label: 'Free trial', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  past_due: { label: 'Payment failed', tone: 'danger' },
  read_only: { label: 'Read-only', tone: 'danger' },
  canceled: { label: 'Cancelled', tone: 'neutral' },
};

/** Billing for the Admin (SRS §12, wireframe "Billing (Admin)"): plan, seats, payment, tax invoices and the failed-payment banner. */
export function BillingTab() {
  const can = useCan();
  const sub = useSubscription();
  const invoices = useInvoices();
  const m = useBillingMutations();
  const [dialog, setDialog] = useState<'plan' | 'seats' | 'cancel' | 'transfer' | null>(null);
  const [transferInvoice, setTransferInvoice] = useState<string | null>(null);
  const manage = can('billing.manage');

  if (sub.isLoading) return <Loading />;
  if (sub.error) return <Alert>{errorMessage(sub.error)}</Alert>;
  const s = sub.data;
  const error = m.resume.error ?? m.paymentMethod.error ?? m.cardSetup.error ?? m.invoicePdf.error ?? m.dataExport.error;

  return (
    <div className="space-y-3">
      {s?.status === 'past_due' ? (
        <Alert>
          Payment failed. Please update your card or pay by bank transfer by <b>{formatDate(s.graceEndsAt)}</b>; after that the CRM becomes read-only. Your data is safe.
        </Alert>
      ) : null}
      {s?.status === 'read_only' ? <Alert>The company is read-only because the invoice is unpaid. You can view and export; paying reactivates it at once.</Alert> : null}
      {s?.cancelAtPeriodEnd ? (
        <Alert tone="warning">
          The subscription ends on {formatDate(s.currentPeriodEnd)}.{' '}
          {manage ? (
            <Button variant="link" size="sm" onClick={() => m.resume.mutate()}>
              Undo cancellation
            </Button>
          ) : null}
        </Alert>
      ) : null}
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      {m.cardSetup.isSuccess ? <Alert tone="info">The card form opens here once Stripe keys are configured for this environment.</Alert> : null}
      {m.dataExport.isSuccess ? <Alert tone="success">Your full data export is being prepared. You will be notified when it is ready.</Alert> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Subscription" />
          <CardBody>
            {!s ? (
              <p className="text-sm text-muted-foreground">This company has no subscription yet. Companies created through sign-up start with a 14-day free trial.</p>
            ) : (
              <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">Plan</dt>
                <dd>
                  {s.plan.name} · {s.billingCycle} <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                </dd>
                <dt className="text-muted-foreground">Seats</dt>
                <dd>
                  {s.seatsUsed} of {s.seats} used{' '}
                  {manage ? (
                    <Button variant="link" size="sm" onClick={() => setDialog('seats')}>
                      Change seats
                    </Button>
                  ) : null}
                </dd>
                <dt className="text-muted-foreground">Price</dt>
                <dd>{formatMoney(s.pricePerSeat, s.currency)} per user + 5% VAT</dd>
                {s.trialEndsAt && s.status === 'trialing' ? (
                  <>
                    <dt className="text-muted-foreground">Trial ends</dt>
                    <dd>{formatDate(s.trialEndsAt)}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Next invoice</dt>
                <dd>{s.nextInvoiceEstimate ? `${formatDate(s.nextInvoiceEstimate.date)} · ${formatMoney(s.nextInvoiceEstimate.total, s.currency)}` : '—'}</dd>
                <dt className="text-muted-foreground">Payment</dt>
                <dd>
                  {s.paymentMethod === 'card' ? `Card ${s.cardLast4 ? `•••• ${s.cardLast4}` : ''}` : 'Bank transfer'}
                  {manage ? (
                    <span className="ml-2">
                      <Button variant="link" size="sm" onClick={() => m.cardSetup.mutate()}>
                        {s.paymentMethod === 'card' ? 'Change card' : 'Pay by card'}
                      </Button>
                      {s.paymentMethod === 'card' ? (
                        <>
                          {' · '}
                          <Button variant="link" size="sm" onClick={() => m.paymentMethod.mutate('bank_transfer')}>
                            Pay by bank transfer
                          </Button>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                </dd>
              </dl>
            )}
            {manage ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {s ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setDialog('plan')}>
                      Change plan
                    </Button>
                    {!s.cancelAtPeriodEnd && s.status !== 'canceled' ? (
                      <Button variant="outline" size="sm" onClick={() => setDialog('cancel')}>
                        Cancel subscription
                      </Button>
                    ) : null}
                  </>
                ) : null}
                <Button variant="outline" size="sm" disabled={m.dataExport.isPending} onClick={() => m.dataExport.mutate()}>
                  Export all data
                </Button>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Invoices (tax invoices, 5% VAT)" />
          <CardBody>
            <Table>
              <thead>
                <tr>
                  <Th>No.</Th>
                  <Th>Period</Th>
                  <Th>Total</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {(invoices.data ?? []).map((inv) => (
                  <Tr key={inv.id}>
                    <Td>#{inv.number}</Td>
                    <Td className="text-xs">
                      {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
                    </Td>
                    <Td>{formatMoney(inv.total, inv.currency)}</Td>
                    <Td>
                      <Badge tone={inv.status === 'paid' ? 'success' : inv.status === 'open' ? 'danger' : 'neutral'}>{inv.status === 'open' ? 'Unpaid' : inv.status}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Button variant="link" size="sm" onClick={() => m.invoicePdf.mutate(inv.id)}>
                        PDF
                      </Button>
                      {inv.status === 'open' && manage ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="ml-2"
                          onClick={() => {
                            setTransferInvoice(inv.id);
                            setDialog('transfer');
                          }}
                        >
                          I paid
                        </Button>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
                {invoices.data?.length === 0 ? (
                  <tr>
                    <Td colSpan={5} className="text-center text-muted-foreground">
                      No invoices yet.
                    </Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      </div>

      <PaymentsAndHistory />

      {s ? <PlanDialog open={dialog === 'plan'} sub={s} onClose={() => setDialog(null)} /> : null}
      {s ? <SeatsDialog open={dialog === 'seats'} sub={s} onClose={() => setDialog(null)} /> : null}
      <CancelDialog open={dialog === 'cancel'} periodEnd={s?.currentPeriodEnd ?? null} onClose={() => setDialog(null)} />
      <TransferDialog
        invoice={(invoices.data ?? []).find((i) => i.id === transferInvoice) ?? null}
        open={dialog === 'transfer'}
        onClose={() => {
          setDialog(null);
          setTransferInvoice(null);
        }}
      />
    </div>
  );
}

function PaymentsAndHistory() {
  const payments = usePayments();
  const history = useHistory();
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader title="Payments" />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Invoice</Th>
                <Th>Method</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {(payments.data ?? []).map((p) => (
                <Tr key={p.id}>
                  <Td className="text-xs">{formatDateTime(p.createdAt)}</Td>
                  <Td>#{p.invoiceNumber ?? ''}</Td>
                  <Td>{p.method === 'card' ? 'Card' : `Transfer ${p.bankReference ?? ''}`}</Td>
                  <Td>{formatMoney(p.amount, p.currency)}</Td>
                  <Td>
                    <Badge tone={p.status === 'succeeded' ? 'success' : p.status === 'failed' ? 'danger' : 'warning'}>{p.status === 'pending' ? 'Waiting for confirmation' : p.status}</Badge>
                  </Td>
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
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Subscription history" />
        <CardBody>
          <ol className="space-y-2 text-sm">
            {(history.data ?? []).map((h) => (
              <li key={h.id} className="border-b border-border pb-2">
                <p className="font-medium">{h.type.replaceAll('_', ' ')}</p>
                <p className="text-xs text-muted-foreground">
                  {h.actorName ?? h.actorType} · {formatDateTime(h.createdAt)}
                  {h.note ? ` · ${h.note}` : ''}
                </p>
              </li>
            ))}
            {history.data?.length === 0 ? <li className="text-muted-foreground">Nothing yet.</li> : null}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}

function PlanDialog({ open, sub, onClose }: { open: boolean; sub: Subscription; onClose: () => void }) {
  const plans = usePlans();
  const { changePlan } = useBillingMutations();
  const [planId, setPlanId] = useState(sub.plan.id);
  const [cycle, setCycle] = useState(sub.billingCycle);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && (changePlan.reset(), onClose())}>
      <DialogContent title="Change plan">
        <div className="space-y-3">
          <Field label="Plan">
            <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.data
                ?.filter((p) => p.selfService)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {formatMoney(p.priceMonthly, p.currency)} per user / month
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Billing">
            <Select value={cycle} onChange={(e) => setCycle(e.target.value as 'monthly' | 'yearly')}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </Select>
          </Field>
          {changePlan.error ? <Alert>{errorMessage(changePlan.error)}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={changePlan.isPending} onClick={async () => (await changePlan.mutateAsync({ planId, billingCycle: cycle }).catch(() => null)) && onClose()}>
              Change plan
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** More seats are charged for the rest of the period; fewer take effect at renewal and never below active users (SRS §12 Seats). */
function SeatsDialog({ open, sub, onClose }: { open: boolean; sub: Subscription; onClose: () => void }) {
  const { seats } = useBillingMutations();
  const [n, setN] = useState(String(sub.seats));
  const value = Number(n);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && (seats.reset(), onClose())}>
      <DialogContent title="Change seats">
        <div className="space-y-3">
          <Field label={`Seats (at least ${sub.seatsUsed} active users)`}>
            <Input type="number" min={sub.seatsUsed} value={n} onChange={(e) => setN(e.target.value)} />
          </Field>
          <p className="text-xs text-muted-foreground">
            {value > sub.seats ? 'Extra seats are charged for the rest of the current period.' : value < sub.seats ? 'Fewer seats take effect at the next renewal.' : ''}
          </p>
          {seats.error ? <Alert>{errorMessage(seats.error)}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={value < sub.seatsUsed || value === sub.seats || seats.isPending} onClick={async () => (await seats.mutateAsync(value).catch(() => null)) && onClose()}>
              Save seats
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ open, periodEnd, onClose }: { open: boolean; periodEnd: string | null; onClose: () => void }) {
  const { cancel } = useBillingMutations();
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && (cancel.reset(), onClose())}>
      <DialogContent title="Cancel subscription">
        <div className="space-y-3 text-sm">
          <p>
            The CRM keeps working until {formatDate(periodEnd)}. There is no refund for a period that has started. You can undo before then. After the end, data can be exported for 90 days and is then
            deleted.
          </p>
          <Field label="Why are you cancelling?">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {cancel.error ? <Alert>{errorMessage(cancel.error)}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Keep subscription
            </Button>
            <Button variant="danger" disabled={cancel.isPending} onClick={async () => (await cancel.mutateAsync(reason).catch(() => null)) && onClose()}>
              Cancel subscription
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ invoice, open, onClose }: { invoice: { id: string; number: string; balance: string; currency: string } | null; open: boolean; onClose: () => void }) {
  const { bankTransfer } = useBillingMutations();
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  return (
    <Dialog open={open && !!invoice} onOpenChange={(o) => !o && (bankTransfer.reset(), onClose())}>
      <DialogContent title={`Bank transfer for invoice #${invoice?.number ?? ''}`}>
        <div className="space-y-3 text-sm">
          <p>Enter the transfer reference. Our team confirms the payment when the money arrives.</p>
          <Field label="Amount">
            <Input inputMode="decimal" value={amount || invoice?.balance || ''} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Field label="Bank reference *">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          {bankTransfer.error ? <Alert>{errorMessage(bankTransfer.error)}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!reference.trim() || bankTransfer.isPending}
              onClick={async () => {
                if (!invoice) return;
                const ok = await bankTransfer.mutateAsync({ id: invoice.id, amount: amount || invoice.balance, bankReference: reference.trim() }).catch(() => null);
                if (ok) {
                  setReference('');
                  setAmount('');
                  onClose();
                }
              }}
            >
              Submit
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
