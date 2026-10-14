'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Field, Input, Select, TabStrip, Table, Td, Th, Tr } from '@crm/ui';
import { Download, Upload } from 'lucide-react';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { openDownload, uploadFile } from '@/core/files';
import { formatDate, formatDateTime, isoToLocalInput, localInputToIso } from '@/core/format';
import { byId, useUsers } from '@/core/lookups';
import { useCan } from '@/core/session';
import { Building, formatPrice, PROPERTY_TYPE_LABEL, Unit, UNIT_STATUS_LABEL, UNIT_STATUS_TONE, UnitStatus, useProjectActions, useUnitFiles, useUnitHistory } from './projects-api';

type Tab = 'details' | 'status' | 'history' | 'files';

/**
 * A unit (SRS §6.2–6.4): details for everyone; editing with projects.manage; status and price with
 * units.change_status (kept in history); floor plans and images.
 */
export function UnitDialog({ projectId, unit, buildings, onClose }: { projectId: string; unit: Unit | null; buildings: Building[]; onClose: () => void }) {
  const can = useCan();
  const [tab, setTab] = useState<Tab>('details');
  const tabs = [
    { key: 'details', label: 'Details' },
    ...(unit && can('units.change_status') ? [{ key: 'status', label: 'Status & price' }] : []),
    ...(unit ? [{ key: 'history', label: 'History' }] : []),
    ...(unit && can('projects.manage') ? [{ key: 'files', label: 'Files' }] : []),
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={unit ? `Unit ${unit.unitNumber}` : 'New unit'} wide>
        {unit ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={UNIT_STATUS_TONE[unit.status]}>{UNIT_STATUS_LABEL[unit.status]}</Badge>
            <span className="font-semibold">{formatPrice(unit.price, unit.currency)}</span>
            {unit.status === 'on_hold' && unit.holdExpiresAt ? <span className="text-xs text-muted-foreground">Hold ends {formatDateTime(unit.holdExpiresAt)}</span> : null}
          </div>
        ) : null}
        {tabs.length > 1 ? <TabStrip items={tabs} value={tab} onChange={(k) => setTab(k as Tab)} /> : null}
        <div className="pt-3">
          {tab === 'details' ? <DetailsForm projectId={projectId} unit={unit} buildings={buildings} readOnly={!can('projects.manage')} onDone={onClose} /> : null}
          {tab === 'status' && unit ? <StatusForm unit={unit} onDone={onClose} /> : null}
          {tab === 'history' && unit ? <History unitId={unit.id} /> : null}
          {tab === 'files' && unit ? <Files unitId={unit.id} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailsForm({ projectId, unit, buildings, readOnly, onDone }: { projectId: string; unit: Unit | null; buildings: Building[]; readOnly: boolean; onDone: () => void }) {
  const { createUnit, updateUnit } = useProjectActions();
  const [f, setF] = useState<Record<string, string>>({});
  const value = (k: keyof Unit) => f[k] ?? (unit?.[k] === null || unit?.[k] === undefined ? '' : String(unit[k]));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = unit ? updateUnit : createUnit;
  const err = (k: string) => (save.error instanceof ApiError ? save.error.fieldError(k) : undefined);
  const NUMBERS = new Set(['bedrooms', 'bathrooms', 'sizeSqft', 'floor']);

  async function submit() {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) {
      const t = v.trim();
      body[k] = t === '' ? (unit ? null : undefined) : NUMBERS.has(k) ? Number(t) : t;
    }
    const ok = await (unit ? updateUnit.mutateAsync({ id: unit.id, ...body }) : createUnit.mutateAsync({ projectId, propertyType: 'apartment', ...body })).catch(() => null);
    if (ok) onDone();
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={readOnly} className="contents">
        <Field label="Unit number *" error={err('unitNumber')}>
          <Input value={value('unitNumber')} onChange={set('unitNumber')} />
        </Field>
        <Field label="Building">
          <Select value={value('buildingId')} onChange={set('buildingId')}>
            <option value="">— (villa / plot)</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type *">
          <Select value={value('propertyType') || 'apartment'} onChange={set('propertyType')}>
            {Object.entries(PROPERTY_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bedrooms * (0 = studio)" error={err('bedrooms')}>
          <Input type="number" min={0} value={value('bedrooms')} onChange={set('bedrooms')} />
        </Field>
        <Field label="Bathrooms">
          <Input type="number" min={0} value={value('bathrooms')} onChange={set('bathrooms')} />
        </Field>
        <Field label="Size (sq ft) *" error={err('sizeSqft')}>
          <Input type="number" min={1} step="0.01" value={value('sizeSqft')} onChange={set('sizeSqft')} />
        </Field>
        <Field label="Floor">
          <Input type="number" value={value('floor')} onChange={set('floor')} />
        </Field>
        <Field label="View">
          <Input value={value('view')} onChange={set('view')} placeholder="Sea, Creek, Park…" />
        </Field>
        {unit ? (
          <Field label="Price">
            <Input value={formatPrice(unit.price, unit.currency)} disabled />
          </Field>
        ) : (
          <Field label="Price (AED) *" error={err('price')}>
            <Input value={f.price ?? ''} onChange={(e) => setF((x) => ({ ...x, price: e.target.value.replace(/[^0-9.]/g, '') }))} placeholder="3250000" />
          </Field>
        )}
        <Field label="Payment plan">
          <Input value={value('paymentPlan')} onChange={set('paymentPlan')} placeholder="60/40" />
        </Field>
        <Field label="Handover date">
          <Input type="date" value={value('handoverDate')} onChange={set('handoverDate')} />
        </Field>
      </fieldset>
      {save.error && !(save.error instanceof ApiError && save.error.status === 400 && Object.keys(f).some((k) => err(k))) ? <Alert className="sm:col-span-3">{errorMessage(save.error)}</Alert> : null}
      {!readOnly ? (
        <div className="flex justify-end gap-2 sm:col-span-3">
          <Button type="submit" disabled={save.isPending || !Object.keys(f).length}>
            {unit ? 'Save details' : 'Create unit'}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function StatusForm({ unit, onDone }: { unit: Unit; onDone: () => void }) {
  const { changeStatus } = useProjectActions();
  const [status, setStatus] = useState<UnitStatus>(unit.status);
  const [price, setPrice] = useState(String(Number(unit.price)));
  const [hold, setHold] = useState(unit.holdExpiresAt ? isoToLocalInput(unit.holdExpiresAt) : isoToLocalInput(new Date(Date.now() + 3 * 86_400_000).toISOString()));
  const [reason, setReason] = useState('');
  const priceChanged = Number(price) !== Number(unit.price);
  const statusChanged = status !== unit.status;
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await changeStatus
          .mutateAsync({
            id: unit.id,
            ...(statusChanged || status === 'on_hold' ? { status } : {}),
            ...(priceChanged ? { price: Number(price).toFixed(2) } : {}),
            ...(status === 'on_hold' ? { holdExpiresAt: localInputToIso(hold) } : {}),
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          })
          .catch(() => null);
        if (ok) onDone();
      }}
    >
      <Field label="Status">
        <Select value={status} onChange={(e) => setStatus(e.target.value as UnitStatus)}>
          {Object.entries(UNIT_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`Price (${unit.currency})`}>
        <Input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} />
      </Field>
      {status === 'on_hold' ? (
        <Field label="Hold until">
          <Input type="datetime-local" value={hold} onChange={(e) => setHold(e.target.value)} />
        </Field>
      ) : null}
      <Field label="Reason" className={status === 'on_hold' ? undefined : 'sm:col-span-2'}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="New price list, client asked for a hold…" />
      </Field>
      {changeStatus.error ? <Alert className="sm:col-span-2">{errorMessage(changeStatus.error)}</Alert> : null}
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" disabled={changeStatus.isPending || (!statusChanged && !priceChanged && status !== 'on_hold')}>
          Save change
        </Button>
      </div>
    </form>
  );
}

function History({ unitId }: { unitId: string }) {
  const history = useUnitHistory(unitId);
  const users = byId(useUsers().data);
  return (
    <Table>
      <thead>
        <tr>
          <Th>When</Th>
          <Th>Status</Th>
          <Th>Price</Th>
          <Th>Reason</Th>
          <Th>By</Th>
        </tr>
      </thead>
      <tbody>
        {(history.data ?? []).map((c, i) => (
          <Tr key={i}>
            <Td className="whitespace-nowrap text-xs">{formatDateTime(c.changedAt)}</Td>
            <Td className="text-xs">{c.newStatus ? `${UNIT_STATUS_LABEL[c.oldStatus as UnitStatus] ?? c.oldStatus} → ${UNIT_STATUS_LABEL[c.newStatus as UnitStatus] ?? c.newStatus}` : '—'}</Td>
            <Td className="whitespace-nowrap text-xs">{c.newPrice ? `${formatPrice(c.oldPrice ?? 0)} → ${formatPrice(c.newPrice)}` : '—'}</Td>
            <Td className="text-xs">{c.reason ?? '—'}</Td>
            <Td className="text-xs">{c.changedBy ? (users.get(c.changedBy)?.fullName ?? '—') : 'System'}</Td>
          </Tr>
        ))}
        {history.data?.length === 0 ? (
          <tr>
            <Td colSpan={5} className="text-center text-muted-foreground">
              No price or status changes yet.
            </Td>
          </tr>
        ) : null}
      </tbody>
    </Table>
  );
}

function Files({ unitId }: { unitId: string }) {
  const files = useUnitFiles(unitId, true);
  const { attachToUnit, updateUnit } = useProjectActions();
  const [category, setCategory] = useState<'floor_plan' | 'image' | 'brochure' | 'document'>('floor_plan');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function add(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fileId = await uploadFile(file, category === 'floor_plan' ? 'unit_floor_plan' : 'project_media');
      await attachToUnit.mutateAsync({ id: unitId, fileId, category });
      if (category === 'floor_plan') await updateUnit.mutateAsync({ id: unitId, floorPlanFileId: fileId });
      await files.refetch();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="h-8 w-auto text-xs" value={category} onChange={(e) => setCategory(e.target.value as typeof category)} aria-label="File type">
          <option value="floor_plan">Floor plan</option>
          <option value="image">Image</option>
          <option value="brochure">Brochure</option>
          <option value="document">Document</option>
        </Select>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
          <Upload className="size-4" /> {busy ? 'Uploading…' : 'Add file'}
          <input type="file" className="hidden" disabled={busy} accept=".pdf,image/*" onChange={(e) => e.target.files?.[0] && void add(e.target.files[0])} />
        </label>
      </div>
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      <Table>
        <tbody>
          {(files.data ?? []).map((a) => (
            <Tr key={a.id}>
              <Td>{a.fileName ?? a.fileId}</Td>
              <Td className="text-xs">{a.category.replace('_', ' ')}</Td>
              <Td className="text-xs">{a.createdAt ? formatDate(a.createdAt) : ''}</Td>
              <Td>
                <Button variant="ghost" size="sm" onClick={() => void openDownload(a.fileId)}>
                  <Download /> Open
                </Button>
              </Td>
            </Tr>
          ))}
          {files.data?.length === 0 ? (
            <tr>
              <Td className="text-center text-muted-foreground">No files yet.</Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </div>
  );
}
