'use client';

import { Alert, Badge, Button, Card, CardBody, CardHeader, cn, Dialog, DialogContent, Field, Input, Select, Table, Td, Tr } from '@crm/ui';
import { Download, Plus, Upload } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { openDownload, uploadFile } from '@/core/files';
import { formatDate } from '@/core/format';
import { byId, useColleagues, useProjectList } from '@/core/lookups';
import { DEAL_STAGE_LABEL, DEAL_STAGE_TONE, DEAL_STEPS, Deal, DealStage, useAvailableUnits, useDealActions, useDealFiles, useLeadDeals } from './deals-api';

const money = (v: string | null | undefined, currency = 'AED') => (v ? `${currency} ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—');

/** Deals of the lead (SRS §6.5): the unit chosen, offer, EOI, booking and sale. */
export function DealsCard({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const deals = useLeadDeals(leadId);
  const projects = byId(useProjectList().data);
  const [open, setOpen] = useState<Deal | 'new' | null>(null);
  return (
    <Card>
      <CardHeader
        title={`Deals (${deals.data?.length ?? 0})`}
        actions={
          canEdit ? (
            <Button variant="link" size="sm" onClick={() => setOpen('new')}>
              <Plus /> New deal
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-2">
        {deals.data?.map((d) => (
          <button key={d.id} type="button" onClick={() => setOpen(d)} className="block w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted">
            <span className="flex items-center gap-2">
              <span className="font-medium">{projects.get(d.projectId)?.name ?? 'Project'}</span>
              <Badge tone={DEAL_STAGE_TONE[d.stage]}>{DEAL_STAGE_LABEL[d.stage]}</Badge>
            </span>
            <span className="text-xs text-muted-foreground">
              {d.stage === 'sold' ? `Sale ${money(d.saleValue, d.currency)}` : d.offerPrice ? `Offer ${money(d.offerPrice, d.currency)}` : 'No offer yet'}
            </span>
          </button>
        ))}
        {deals.data?.length === 0 ? <p className="text-sm text-muted-foreground">No deal yet.</p> : null}
      </CardBody>
      {open === 'new' ? <NewDealDialog leadId={leadId} onClose={() => setOpen(null)} /> : open ? <DealDialog leadId={leadId} deal={open} canEdit={canEdit} onClose={() => setOpen(null)} /> : null}
    </Card>
  );
}

function NewDealDialog({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const projects = useProjectList();
  const [projectId, setProjectId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [offer, setOffer] = useState('');
  const units = useAvailableUnits(projectId || undefined);
  const { create } = useDealActions(leadId);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New deal">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await create.mutateAsync({ projectId, ...(unitId ? { unitId } : {}), ...(offer ? { offerPrice: offer } : {}) }).catch(() => null);
            if (ok) onClose();
          }}
        >
          <Field label="Project *">
            <Select value={projectId} onChange={(e) => (setProjectId(e.target.value), setUnitId(''))}>
              <option value="">Choose…</option>
              {projects.data
                ?.filter((p) => p.isActive)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Unit">
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={!projectId}>
              <option value="">Not chosen yet</option>
              {units.data
                ?.filter((u) => u.status === 'available')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.unitNumber} · {u.bedrooms === 0 ? 'Studio' : `${u.bedrooms} bed`} · {money(u.price, u.currency)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Offer price (AED)" error={create.error instanceof ApiError ? create.error.fieldError('offerPrice') : undefined}>
            <Input value={offer} onChange={(e) => setOffer(e.target.value.replace(/[^0-9.]/g, ''))} />
          </Field>
          {create.error ? <Alert>{errorMessage(create.error)}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!projectId || create.isPending}>
              Open deal
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const NEXT: Record<DealStage, DealStage[]> = { offer: ['eoi', 'booking', 'sold'], eoi: ['booking', 'sold'], booking: ['sold'], sold: [], cancelled: [] };

function DealDialog({ leadId, deal, canEdit, onClose }: { leadId: string; deal: Deal; canEdit: boolean; onClose: () => void }) {
  const projects = byId(useProjectList().data);
  const people = byId(useColleagues().data);
  const units = useAvailableUnits(deal.projectId);
  const unit = units.data?.find((u) => u.id === deal.unitId);
  const { stage } = useDealActions(leadId);
  const [target, setTarget] = useState<DealStage | null>(null);
  const [unitId, setUnitId] = useState(deal.unitId ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const open = deal.stage !== 'sold' && deal.stage !== 'cancelled';
  const busy = stage.error instanceof ApiError && stage.error.problem.code === 'UNIT_ALREADY_BOOKED';

  async function move() {
    const ok = await stage
      .mutateAsync({
        id: deal.id,
        stage: target as 'eoi' | 'booking' | 'sold' | 'cancelled',
        ...(target === 'cancelled' ? { cancelledReason: reason.trim() } : { date, ...(amount ? { amount } : {}) }),
        ...(unitId && unitId !== deal.unitId ? { unitId } : {}),
      })
      .catch(() => null);
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Deal · ${projects.get(deal.projectId)?.name ?? 'Project'}`} wide>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-1">
            {DEAL_STEPS.map((s, i) => {
              const reached = deal.stage !== 'cancelled' && DEAL_STEPS.indexOf(deal.stage) >= i;
              return (
                <span key={s} className={cn('rounded-full px-3 py-1 text-xs font-medium', reached ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                  {DEAL_STAGE_LABEL[s]}
                </span>
              );
            })}
            {deal.stage === 'cancelled' ? <Badge tone="danger">Cancelled: {deal.cancelledReason}</Badge> : null}
          </div>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">Unit:</span>{' '}
              {deal.unitId ? (
                <Link className="text-primary hover:underline" href={`/projects/${deal.projectId}`}>
                  {unit?.unitNumber ?? 'Unit'}
                </Link>
              ) : (
                'Not chosen yet'
              )}
            </p>
            <p>
              <span className="text-muted-foreground">Agent:</span> {people.get(deal.ownerUserId)?.fullName ?? '—'}
            </p>
            <p>
              <span className="text-muted-foreground">Offer:</span> {money(deal.offerPrice, deal.currency)} {deal.offerDate ? `(${formatDate(deal.offerDate, 'UTC')})` : ''}
            </p>
            <p>
              <span className="text-muted-foreground">EOI:</span> {money(deal.eoiAmount, deal.currency)} {deal.eoiDate ? `(${formatDate(deal.eoiDate, 'UTC')})` : ''}
            </p>
            <p>
              <span className="text-muted-foreground">Booking:</span> {money(deal.bookingAmount, deal.currency)} {deal.bookingDate ? `(${formatDate(deal.bookingDate, 'UTC')})` : ''}
            </p>
            <p>
              <span className="text-muted-foreground">Sale:</span> {money(deal.saleValue, deal.currency)} {deal.saleDate ? `(${formatDate(deal.saleDate, 'UTC')})` : ''}
            </p>
          </div>

          {canEdit && open ? (
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap gap-2">
                {NEXT[deal.stage].map((s) => (
                  <Button key={s} size="sm" variant={target === s ? 'primary' : 'outline'} onClick={() => setTarget(s)}>
                    {s === 'eoi' ? 'Record EOI' : s === 'booking' ? 'Record booking' : 'Mark sold'}
                  </Button>
                ))}
                <Button size="sm" variant={target === 'cancelled' ? 'danger' : 'outline'} onClick={() => setTarget('cancelled')}>
                  Cancel deal
                </Button>
              </div>
              {target && target !== 'cancelled' ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  {deal.stage === 'offer' ? (
                    <Field label="Unit">
                      <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                        <option value="">Not chosen</option>
                        {units.data
                          ?.filter((u) => u.status === 'available' || u.id === deal.unitId)
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.unitNumber} · {money(u.price, u.currency)}
                            </option>
                          ))}
                      </Select>
                    </Field>
                  ) : null}
                  <Field label={target === 'sold' ? 'Sale value *' : target === 'eoi' ? 'EOI amount' : 'Booking amount'}>
                    <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
                  </Field>
                  <Field label="Date">
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </Field>
                </div>
              ) : null}
              {target === 'cancelled' ? (
                <Field label="Reason *">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
              ) : null}
              {busy ? <Alert>Another deal already holds this unit. Choose another unit.</Alert> : stage.error ? <Alert>{errorMessage(stage.error)}</Alert> : null}
              {target ? (
                <div className="flex justify-end">
                  <Button size="sm" disabled={stage.isPending || (target === 'cancelled' && !reason.trim())} onClick={() => void move()}>
                    Save
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {canEdit ? <DealFiles leadId={leadId} dealId={deal.id} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DealFiles({ leadId, dealId }: { leadId: string; dealId: string }) {
  const files = useDealFiles(dealId, true);
  const { attach } = useDealActions(leadId);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function add(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fileId = await uploadFile(file, 'lead_attachment');
      await attach.mutateAsync({ id: dealId, fileId, category: 'contract' });
      await files.refetch();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Files (offer, EOI, booking form)</p>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
          <Upload className="size-3.5" /> {busy ? 'Uploading…' : 'Add file'}
          <input type="file" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && void add(e.target.files[0])} />
        </label>
      </div>
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      <Table>
        <tbody>
          {(files.data ?? []).map((a) => (
            <Tr key={a.id}>
              <Td>{a.fileName ?? a.fileId}</Td>
              <Td className="text-xs">{a.createdAt ? formatDate(a.createdAt) : ''}</Td>
              <Td>
                <Button variant="ghost" size="sm" onClick={() => void openDownload(a.fileId)}>
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
