'use client';

import { Alert, Badge, Button, Input, Loading, cn } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CalendarClock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError, errorMessage, unwrap } from '@/core/api';
import { useStages, useSubstatuses } from '@/core/lookups';
import { InlineName } from './sources-reasons';
import { ConfigShell, Switch } from './ui';

type Stage = Schemas['LeadStage'];
type Substatus = Schemas['LeadSubstatus'];

/**
 * Global Configuration › Manage Status (§5). The four statuses Hot, Warm, Cold and Sale Done are fixed; the Admin
 * adds, renames, orders, turns off and (when no lead used it) deletes their substatuses. Names are unique per status.
 */
export function StatusPage() {
  const stages = useStages();
  const subs = useSubstatuses();
  return (
    <ConfigShell title="Manage Status" description="Configure lead statuses and substatuses. The four statuses are fixed; substatuses are yours to manage.">
      {stages.isLoading || subs.isLoading ? <Loading /> : null}
      {stages.error || subs.error ? <Alert>{errorMessage(stages.error ?? subs.error)}</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {(stages.data ?? []).map((s) => (
          <StatusCard key={s.id} stage={s} substatuses={(subs.data ?? []).filter((x) => x.stageId === s.id).sort((a, b) => a.sortOrder - b.sortOrder)} />
        ))}
      </div>
    </ConfigShell>
  );
}

function StatusCard({ stage, substatuses }: { stage: Stage; substatuses: Substatus[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['lead-substatuses'] });
  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST('/lead-substatuses', { body: { stageId: stage.id, name: name.trim(), requiresScheduling: schedule } })),
    onSuccess: () => {
      setName('');
      setSchedule(false);
      void refresh();
    },
  });
  const update = useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & Schemas['LeadSubstatusInput']) => unwrap(await api.PATCH('/lead-substatuses/{id}', { params: { path: { id } }, body })),
    onSuccess: refresh,
  });
  const reorder = useMutation({
    mutationFn: async (ids: string[]) => unwrap(await api.PUT('/lead-substatuses/order', { body: { stageId: stage.id, ids } })),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE('/lead-substatuses/{id}', { params: { path: { id } } })),
    onSuccess: refresh,
  });
  const move = (i: number, dir: -1 | 1) => {
    const ids = substatuses.map((x) => x.id);
    [ids[i], ids[i + dir]] = [ids[i + dir]!, ids[i]!];
    reorder.mutate(ids);
  };
  const error = create.error ?? update.error ?? reorder.error ?? remove.error;
  const inUse = remove.error instanceof ApiError && remove.error.status === 409;
  const duplicate = name.trim() && substatuses.some((x) => x.name.toLowerCase() === name.trim().toLowerCase());

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-surface shadow-sm">
      <header className="flex items-start gap-3 border-b border-border p-4">
        <span className="mt-1 size-3.5 shrink-0 rounded-full" style={{ background: stage.color }} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {stage.name}
            {stage.category === 'open' ? <Badge tone="info">Open</Badge> : stage.category === 'won' ? <Badge tone="success">Closed · won</Badge> : <Badge tone="neutral">Closed · needs a substatus</Badge>}
            {stage.requiresScheduling ? (
              <Badge tone="warning">
                <CalendarClock className="mr-1 size-3" />
                Needs a follow-up date
              </Badge>
            ) : null}
          </p>
          {stage.description ? <p className="text-sm text-muted-foreground">{stage.description}</p> : null}
        </div>
      </header>
      <ul className="divide-y divide-border">
        {substatuses.map((x, i) => (
          <li key={x.id} className={cn('flex items-center gap-2 px-4 py-2 text-sm', !x.isActive && 'opacity-60')}>
            <div className="flex flex-col">
              <button type="button" aria-label="Move up" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                <ArrowUp className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Move down"
                disabled={i === substatuses.length - 1 || reorder.isPending}
                onClick={() => move(i, 1)}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ArrowDown className="size-3.5" />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <InlineName value={x.name} onSave={(n) => update.mutate({ id: x.id, name: n })} />
              {!x.isActive ? <span className="ml-2 text-xs text-muted-foreground">(inactive)</span> : null}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Choosing it needs a date and time">
              <CalendarClock className="size-3.5" />
              <Switch checked={x.requiresScheduling} onChange={(v) => update.mutate({ id: x.id, requiresScheduling: v })} label={`${x.name} requires scheduling`} />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Active
              <Switch checked={x.isActive} onChange={(v) => update.mutate({ id: x.id, isActive: v })} label={`${x.name} active`} />
            </label>
            <button
              type="button"
              aria-label={`Delete ${x.name}`}
              className="text-muted-foreground hover:text-danger"
              onClick={() => window.confirm(`Delete "${x.name}"? Only possible when no lead has used it.`) && remove.mutate(x.id)}
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {substatuses.length === 0 ? <li className="px-4 py-3 text-sm text-muted-foreground">No substatuses.</li> : null}
      </ul>
      <form
        className="mt-auto flex flex-wrap items-center gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !duplicate) create.mutate();
        }}
      >
        <Input className="h-8 min-w-0 flex-1 text-sm" placeholder={`New ${stage.name} substatus`} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} /> Requires scheduling
        </label>
        <Button size="sm" type="submit" disabled={!name.trim() || !!duplicate || create.isPending}>
          <Plus className="size-4" /> Add Substatus
        </Button>
        {duplicate ? <p className="w-full text-xs text-danger">{stage.name} already has a substatus with this name.</p> : null}
        {error ? <p className="w-full text-xs text-danger">{inUse ? 'Leads have used this substatus, so it cannot be deleted. Turn it off instead.' : errorMessage(error)}</p> : null}
      </form>
    </section>
  );
}
