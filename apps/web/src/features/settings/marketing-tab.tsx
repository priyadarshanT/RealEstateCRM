'use client';

import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, DialogContent, Field, Input, Select, Table, Td, Th, Tr } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { ymd } from '@/core/date-range';
import { formatDateTime, formatMoney, isoToLocalInput, localInputToIso } from '@/core/format';
import { byId, useCampaigns, useSources } from '@/core/lookups';

type Campaign = Schemas['Campaign'];
type Event = Schemas['Event'];

/** Campaigns with daily ad spend (SRS §8.3) and events / roadshows (§8.5) used by the marketing reports. */
export function MarketingTab() {
  return (
    <div className="space-y-3">
      <CampaignsCard />
      <EventsCard />
    </div>
  );
}

function CampaignsCard() {
  const qc = useQueryClient();
  const campaigns = useCampaigns();
  const sources = useSources();
  const sourceById = byId(sources.data);
  const [name, setName] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [spendFor, setSpendFor] = useState<Campaign | null>(null);
  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST('/campaigns', { body: { name: name.trim(), sourceId, status: 'active' } as Campaign })),
    onSuccess: () => {
      setName('');
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Campaign['status'] }) =>
      unwrap(await api.PATCH('/campaigns/{id}', { params: { path: { id } }, body: { status } as Campaign })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  return (
    <Card>
      <CardHeader title="Campaigns and ad spend" />
      <CardBody className="space-y-3">
        <Table>
          <thead>
            <tr>
              <Th>Campaign</Th>
              <Th>Source</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {(campaigns.data ?? []).map((c) => (
              <Tr key={c.id}>
                <Td className="font-medium">
                  {c.name}
                  {c.externalId ? <span className="block text-xs text-muted-foreground">Ad account ID {c.externalId}</span> : null}
                </Td>
                <Td>{sourceById.get(c.sourceId)?.name ?? '—'}</Td>
                <Td>
                  <Select className="h-7 w-28 text-xs" value={c.status} onChange={(e) => setStatus.mutate({ id: c.id, status: e.target.value as Campaign['status'] })} aria-label="Status">
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="ended">Ended</option>
                  </Select>
                </Td>
                <Td>
                  <Button variant="link" size="sm" onClick={() => setSpendFor(c)}>
                    Ad spend
                  </Button>
                </Td>
              </Tr>
            ))}
            {campaigns.data?.length === 0 ? (
              <tr>
                <Td colSpan={4} className="text-center text-muted-foreground">
                  No campaigns yet. Meta campaigns appear automatically once Meta is connected.
                </Td>
              </tr>
            ) : null}
          </tbody>
        </Table>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && sourceId) create.mutate();
          }}
        >
          <Input className="h-8 w-56 text-xs" placeholder="New campaign" value={name} onChange={(e) => setName(e.target.value)} />
          <Select className="h-8 w-40 text-xs" value={sourceId} onChange={(e) => setSourceId(e.target.value)} aria-label="Source">
            <option value="">Source…</option>
            {sources.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Button size="sm" type="submit" disabled={!name.trim() || !sourceId || create.isPending}>
            <Plus /> Add campaign
          </Button>
        </form>
        {create.error || setStatus.error ? <Alert>{errorMessage(create.error ?? setStatus.error)}</Alert> : null}
        <SpendDialog campaign={spendFor} onClose={() => setSpendFor(null)} />
      </CardBody>
    </Card>
  );
}

/** Manual daily ad spend. Imported spend (from ad accounts) is shown but entered by the sync. */
function SpendDialog({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const qc = useQueryClient();
  const from = ymd(new Date(Date.now() - 29 * 86_400_000));
  const to = ymd(new Date());
  const spend = useQuery({
    queryKey: ['spend', campaign?.id],
    enabled: !!campaign,
    queryFn: async () => unwrap(await api.GET('/campaigns/{id}/spend', { params: { path: { id: campaign!.id }, query: { from, to } } })).data,
  });
  const [date, setDate] = useState(to);
  const [amount, setAmount] = useState('');
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PUT('/campaigns/{id}/spend', {
          params: { path: { id: campaign!.id } },
          body: { days: [{ spendDate: date, amount: Number(amount).toFixed(2), currency: 'AED', entryMethod: 'manual' }] },
        }),
      ),
    onSuccess: () => {
      setAmount('');
      void qc.invalidateQueries({ queryKey: ['spend', campaign?.id] });
      void qc.invalidateQueries({ queryKey: ['report'] });
    },
  });
  const total = (spend.data ?? []).reduce((s, d) => s + Number(d.amount), 0);

  return (
    <Dialog open={!!campaign} onOpenChange={(o) => !o && (save.reset(), onClose())}>
      <DialogContent title={`Ad spend · ${campaign?.name ?? ''}`}>
        <div className="space-y-3">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (Number(amount) >= 0 && amount) save.mutate();
            }}
          >
            <Field label="Day">
              <Input type="date" value={date} max={to} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Amount (AED)">
              <Input inputMode="decimal" className="w-32" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
            </Field>
            <Button type="submit" disabled={!amount || save.isPending}>
              Save day
            </Button>
          </form>
          {save.error ? <Alert>{errorMessage(save.error)}</Alert> : null}
          <Table>
            <thead>
              <tr>
                <Th>Day</Th>
                <Th>Amount</Th>
                <Th>Entered</Th>
              </tr>
            </thead>
            <tbody>
              {(spend.data ?? []).map((d) => (
                <Tr key={d.spendDate}>
                  <Td>{d.spendDate}</Td>
                  <Td>{formatMoney(d.amount, d.currency)}</Td>
                  <Td>
                    <Badge>{d.entryMethod === 'api' ? 'Imported' : 'Manual'}</Badge>
                  </Td>
                </Tr>
              ))}
              <tr className="font-semibold">
                <Td>Last 30 days</Td>
                <Td>{formatMoney(String(total))}</Td>
                <Td />
              </tr>
            </tbody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EventsCard() {
  const qc = useQueryClient();
  const events = useQuery({ queryKey: ['events'], queryFn: async () => unwrap(await api.GET('/events', { params: { query: { limit: 100 } } })).data });
  const [editing, setEditing] = useState<Event | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE('/events/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  });

  return (
    <Card>
      <CardHeader
        title="Events and roadshows"
        actions={
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus /> New event
          </Button>
        }
      />
      <CardBody className="space-y-3">
        <Table>
          <thead>
            <tr>
              <Th>Event</Th>
              <Th>Type</Th>
              <Th>When</Th>
              <Th>Location</Th>
              <Th>Cost</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {(events.data ?? []).map((e) => (
              <Tr key={e.id}>
                <Td className="font-medium">{e.name}</Td>
                <Td>{e.type.replace('_', ' ')}</Td>
                <Td className="text-xs">
                  {formatDateTime(e.startsAt)} – {formatDateTime(e.endsAt)}
                </Td>
                <Td>{e.location ?? '—'}</Td>
                <Td>{e.cost ? formatMoney(e.cost, e.currency ?? 'AED') : '—'}</Td>
                <Td className="whitespace-nowrap">
                  <Button variant="link" size="sm" onClick={() => setEditing(e)}>
                    Edit
                  </Button>
                  <Button variant="link" size="sm" className="ml-3 text-danger" onClick={() => window.confirm(`Delete ${e.name}?`) && remove.mutate(e.id)}>
                    Delete
                  </Button>
                </Td>
              </Tr>
            ))}
            {events.data?.length === 0 ? (
              <tr>
                <Td colSpan={6} className="text-center text-muted-foreground">
                  No events yet. Create one to tag leads from a roadshow or exhibition.
                </Td>
              </tr>
            ) : null}
          </tbody>
        </Table>
        {remove.error ? <Alert>{errorMessage(remove.error)}</Alert> : null}
        <EventDialog event={editing} onClose={() => setEditing(null)} />
      </CardBody>
    </Card>
  );
}

function EventDialog({ event, onClose }: { event: Event | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const existing = event && event !== 'new' ? event : null;
  const [form, setForm] = useState<Partial<Event> | null>(null);
  const v: Partial<Event> = form ?? existing ?? { type: 'event', currency: 'AED' };
  const set = (p: Partial<Event>) => setForm({ ...v, ...p });
  const save = useMutation({
    mutationFn: async () => {
      const body = { name: v.name, type: v.type, location: v.location, startsAt: v.startsAt, endsAt: v.endsAt, cost: v.cost || null, currency: v.cost ? (v.currency ?? 'AED') : null } as Event;
      return existing ? unwrap(await api.PATCH('/events/{id}', { params: { path: { id: existing.id } }, body })) : unwrap(await api.POST('/events', { body }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['events'] });
      close();
    },
  });
  function close() {
    setForm(null);
    save.reset();
    onClose();
  }
  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && close()}>
      <DialogContent title={existing ? `Edit ${existing.name}` : 'New event'}>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Name *" className="sm:col-span-2">
            <Input value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} required placeholder="Cityscape roadshow" />
          </Field>
          <Field label="Type">
            <Select value={v.type} onChange={(e) => set({ type: e.target.value as Event['type'] })}>
              <option value="event">Event</option>
              <option value="roadshow">Roadshow</option>
              <option value="exhibition">Exhibition</option>
              <option value="open_house">Open house</option>
            </Select>
          </Field>
          <Field label="Location">
            <Input value={v.location ?? ''} onChange={(e) => set({ location: e.target.value })} />
          </Field>
          <Field label="Starts *">
            <Input type="datetime-local" required value={v.startsAt ? isoToLocalInput(v.startsAt) : ''} onChange={(e) => set({ startsAt: localInputToIso(e.target.value) })} />
          </Field>
          <Field label="Ends *">
            <Input type="datetime-local" required value={v.endsAt ? isoToLocalInput(v.endsAt) : ''} onChange={(e) => set({ endsAt: localInputToIso(e.target.value) })} />
          </Field>
          <Field label="Cost (AED)">
            <Input inputMode="decimal" value={v.cost ?? ''} onChange={(e) => set({ cost: e.target.value.replace(/[^\d.]/g, '') || null })} />
          </Field>
          {save.error ? <Alert className="sm:col-span-2">{errorMessage(save.error)}</Alert> : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Save event
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
