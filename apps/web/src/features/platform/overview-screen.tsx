'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Field, Input, Loading, Select, StatCard, Table, Td, Th, Tr } from '@crm/ui';
import { useState } from 'react';
import { errorMessage } from '@/core/api';
import { formatDate, formatDateTime, formatMoney, formatMoneyShort } from '@/core/format';
import { useMetrics, usePlatformMe, useTenantActions, useTenants, type PlatformTenant, type TenantQuery } from './platform-api';

const SUB_STATUS = {
  trialing: ['Trial', 'info'],
  active: ['Active', 'success'],
  past_due: ['Payment failed', 'danger'],
  read_only: ['Read-only', 'danger'],
  canceled: ['Cancelled', 'neutral'],
} as const;

/** Every company with plan, seats, status, usage and invoices, plus income and what needs attention (SRS §12 Owner console 2). */
export function OverviewScreen() {
  const metrics = useMetrics();
  const [query, setQuery] = useState<TenantQuery>({});
  const tenants = useTenants(query);
  const [open, setOpen] = useState<PlatformTenant | null>(null);
  const m = metrics.data;

  return (
    <div className="space-y-4">
      {metrics.error ? <Alert>{errorMessage(metrics.error)}</Alert> : null}
      {m ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <StatCard label="Monthly income (MRR)" value={formatMoneyShort(m.mrr)} accent="#15803d" />
          <StatCard label="Yearly (ARR)" value={formatMoneyShort(m.arr)} accent="#15803d" />
          <StatCard label="Paying companies" value={m.payingTenants} accent="#3b6fe0" />
          <StatCard label="In trial" value={m.trialingTenants} accent="#3b6fe0" onClick={() => setQuery({ subscriptionStatus: 'trialing' })} />
          <StatCard label="Payment failed" value={m.pastDueTenants ?? 0} accent="#c62828" onClick={() => setQuery({ subscriptionStatus: 'past_due' })} />
          <StatCard label="Read-only" value={m.readOnlyTenants ?? 0} accent="#c62828" onClick={() => setQuery({ subscriptionStatus: 'read_only' })} />
          <StatCard label="Paid seats" value={m.paidSeats} accent="#8b5cf6" />
          <StatCard label="New trials (30 days)" value={m.newTrials30d ?? 0} accent="#8b5cf6" />
          <StatCard label="Trial conversion (30 days)" value={`${Math.round((m.trialConversion30d ?? 0) * 100)}%`} accent="#8b5cf6" />
          <StatCard label="Churned (30 days)" value={m.churned30d ?? 0} accent="#64748b" />
          <StatCard label="Bank transfers to confirm" value={m.pendingBankTransfers ?? 0} accent="#f2b33d" />
          <StatCard label="Licences to verify" value={m.pendingVerifications ?? 0} accent="#f2b33d" onClick={() => setQuery({ verificationStatus: 'pending' })} />
        </div>
      ) : metrics.isLoading ? (
        <Loading />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-base font-semibold">Companies</h2>
        <Input className="h-8 w-56 text-xs" placeholder="Search name or email…" value={query.q ?? ''} onChange={(e) => setQuery({ ...query, q: e.target.value || undefined })} />
        <Select
          className="h-8 w-auto text-xs"
          value={query.subscriptionStatus ?? ''}
          onChange={(e) => setQuery({ ...query, subscriptionStatus: (e.target.value || undefined) as TenantQuery['subscriptionStatus'] })}
          aria-label="Subscription status"
        >
          <option value="">Any status</option>
          {Object.entries(SUB_STATUS).map(([k, [label]]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          className="h-8 w-auto text-xs"
          value={query.verificationStatus ?? ''}
          onChange={(e) => setQuery({ ...query, verificationStatus: (e.target.value || undefined) as TenantQuery['verificationStatus'] })}
          aria-label="Licence"
        >
          <option value="">Any licence status</option>
          <option value="pending">Pending check</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
        </Select>
      </div>
      {tenants.error ? <Alert>{errorMessage(tenants.error)}</Alert> : null}
      <Table>
        <thead>
          <tr>
            <Th>Company</Th>
            <Th>Plan</Th>
            <Th>Seats</Th>
            <Th>Status</Th>
            <Th>Licence</Th>
            <Th>Leads this month</Th>
            <Th>Last active</Th>
          </tr>
        </thead>
        <tbody>
          {(tenants.data ?? []).map((t) => {
            const s = t.subscription;
            const [label, tone] = s ? SUB_STATUS[s.status] : (['No subscription', 'neutral'] as const);
            return (
              <Tr key={t.id} className="cursor-pointer" onClick={() => setOpen(t)}>
                <Td>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.type === 'brokerage' ? 'Brokerage' : 'Agent'} · {t.adminEmail}
                  </p>
                </Td>
                <Td>{s ? `${s.plan.name} · ${s.billingCycle}` : '—'}</Td>
                <Td>{s ? `${s.seatsUsed}/${s.seats}` : '—'}</Td>
                <Td>
                  <Badge tone={tone}>{label}</Badge>
                  {t.status === 'suspended' ? <Badge tone="danger" className="ml-1">Suspended</Badge> : null}
                </Td>
                <Td>
                  <Badge tone={t.verificationStatus === 'verified' ? 'success' : t.verificationStatus === 'rejected' ? 'danger' : 'warning'}>{t.verificationStatus}</Badge>
                </Td>
                <Td>{t.usage?.leadsThisMonth ?? 0}</Td>
                <Td className="text-xs">{formatDateTime(t.lastActiveAt)}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      <TenantDialog tenant={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Our team's actions on a company (SRS §12 Owner console 3). Every action is logged. */
function TenantDialog({ tenant, onClose }: { tenant: PlatformTenant | null; onClose: () => void }) {
  const me = usePlatformMe();
  const a = useTenantActions();
  const owner = me.data?.role === 'owner';
  const [note, setNote] = useState('');
  const [days, setDays] = useState('7');
  const [price, setPrice] = useState('');
  const [seats, setSeats] = useState('');
  const error = a.verify.error ?? a.extend.error ?? a.suspend.error ?? a.unsuspend.error ?? a.subscription.error;
  const done = () => {
    setNote('');
    onClose();
  };
  if (!tenant) return null;
  const s = tenant.subscription;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={tenant.name} wide>
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5">
            <dt className="text-muted-foreground">Type</dt>
            <dd>{tenant.type === 'brokerage' ? 'Brokerage' : 'Individual agent'}</dd>
            <dt className="text-muted-foreground">{tenant.type === 'brokerage' ? 'Licence / RERA ORN' : 'RERA BRN'}</dt>
            <dd>{tenant.type === 'brokerage' ? `${tenant.tradeLicenseNo ?? '—'} / ${tenant.reraOrn ?? '—'}` : (tenant.reraBrn ?? '—')}</dd>
            <dt className="text-muted-foreground">Admin</dt>
            <dd>{tenant.adminEmail}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDate(tenant.createdAt)}</dd>
            {s ? (
              <>
                <dt className="text-muted-foreground">Subscription</dt>
                <dd>
                  {s.plan.name} · {s.billingCycle} · {s.seatsUsed}/{s.seats} seats · {formatMoney(s.pricePerSeat, s.currency)} per seat
                </dd>
                <dt className="text-muted-foreground">Trial / grace ends</dt>
                <dd>
                  {formatDate(s.trialEndsAt)} / {formatDate(s.graceEndsAt)}
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Usage</dt>
            <dd>
              {tenant.usage?.leadsThisMonth ?? 0} leads this month · {tenant.usage?.invitedUsers ?? 0} invited users
            </dd>
          </dl>

          <Field label="Note (kept in the log)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Licence checked on DED portal" />
          </Field>

          <div className="flex flex-wrap gap-2">
            {tenant.verificationStatus !== 'verified' ? (
              <Button size="sm" onClick={async () => (await a.verify.mutateAsync({ id: tenant.id, result: 'verified', note }).catch(() => null)) && done()}>
                Verify licence
              </Button>
            ) : null}
            {tenant.verificationStatus === 'pending' ? (
              <Button size="sm" variant="outline" onClick={async () => (await a.verify.mutateAsync({ id: tenant.id, result: 'rejected', note }).catch(() => null)) && done()}>
                Reject licence
              </Button>
            ) : null}
          </div>

          {owner ? (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Extend trial or grace (days)">
                  <Input type="number" min={1} className="w-28" value={days} onChange={(e) => setDays(e.target.value)} />
                </Field>
                <Button size="sm" variant="outline" disabled={!note.trim()} onClick={async () => (await a.extend.mutateAsync({ id: tenant.id, days: Number(days), note }).catch(() => null)) && done()}>
                  Extend
                </Button>
              </div>
              {s ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Price per seat (Enterprise)">
                    <Input inputMode="decimal" className="w-32" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={s.pricePerSeat} />
                  </Field>
                  <Field label="Seats">
                    <Input type="number" className="w-24" value={seats} onChange={(e) => setSeats(e.target.value)} placeholder={String(s.seats)} />
                  </Field>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!note.trim() || (!price && !seats)}
                    onClick={async () =>
                      (await a.subscription
                        .mutateAsync({ id: s.id, note, ...(price ? { pricePerSeat: Number(price).toFixed(2) } : {}), ...(seats ? { seats: Number(seats) } : {}) })
                        .catch(() => null)) && done()
                    }
                  >
                    Update subscription
                  </Button>
                </div>
              ) : null}
              <div className="flex gap-2">
                {tenant.status === 'suspended' ? (
                  <Button size="sm" variant="outline" onClick={async () => (await a.unsuspend.mutateAsync(tenant.id).catch(() => null)) && done()}>
                    Unsuspend
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={!note.trim()}
                    onClick={async () => window.confirm(`Suspend ${tenant.name}?`) && (await a.suspend.mutateAsync({ id: tenant.id, reason: note }).catch(() => null)) && done()}
                  >
                    Suspend company
                  </Button>
                )}
              </div>
            </>
          ) : null}
          {error ? <Alert>{errorMessage(error)}</Alert> : null}
          <p className="text-xs text-muted-foreground">Our team cannot see a company&apos;s leads or messages. Every action here is logged.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
