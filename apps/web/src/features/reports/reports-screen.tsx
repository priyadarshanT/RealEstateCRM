'use client';

import { Alert, Button, EmptyState, Loading, Select, Table, Td, Th, Tr, cn } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { DATE_PRESETS, presetRange, type DatePreset } from '@/core/date-range';
import { formatDateTime, formatMoney } from '@/core/format';
import { useCampaigns, useSources, useTeams, useUsers } from '@/core/lookups';
import { useCan, useMe } from '@/core/session';
import { ExportButton } from './export-button';

type Definition = Schemas['ReportDefinition'];

const MODULE_LABEL: Record<string, string> = { leads: 'Leads', marketing: 'Marketing', performance: 'Performance', events: 'Events' };

/** Pick a report, filter by date, source, campaign, team and agent, and export (SRS §8). */
export function ReportsScreen() {
  const can = useCan();
  const me = useMe();
  const defs = useQuery({ queryKey: ['reports'], queryFn: async () => unwrap(await api.GET('/reports')).data });
  const [key, setKey] = useState<string | null>(null);
  const current = defs.data?.find((d) => d.key === key) ?? defs.data?.[0];

  const groups = useMemo(() => {
    const g = new Map<string, Definition[]>();
    for (const d of defs.data ?? []) g.set(d.module ?? 'other', [...(g.get(d.module ?? 'other') ?? []), d]);
    return [...g.entries()];
  }, [defs.data]);

  if (defs.isLoading) return <Loading />;
  if (defs.error) return <Alert>{errorMessage(defs.error)}</Alert>;

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Reports{current ? ` › ${current.name}` : ''}</h1>
      <div className="grid gap-3 lg:grid-cols-[15rem_1fr]">
        <nav className="h-fit rounded-lg border border-border bg-surface p-2">
          {groups.map(([module, items]) => (
            <div key={module} className="mb-2">
              <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase text-muted-foreground">{MODULE_LABEL[module] ?? module}</p>
              {items.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setKey(d.key)}
                  className={cn(
                    'block w-full rounded px-2 py-1.5 text-left text-sm',
                    d.key === current?.key ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-muted',
                  )}
                >
                  {d.name}
                </button>
              ))}
            </div>
          ))}
        </nav>
        {current ? <ReportView key={current.key} def={current} canExport={can('reports.export')} timeZone={me.data?.user.timezone} /> : <EmptyState title="No reports" />}
      </div>
    </div>
  );
}

function ReportView({ def, canExport, timeZone }: { def: Definition; canExport: boolean; timeZone?: string }) {
  const can = useCan();
  const sources = useSources();
  const campaigns = useCampaigns();
  const teams = useTeams();
  const users = useUsers();
  const [preset, setPreset] = useState<DatePreset>('thisMonth');
  const [f, setF] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | undefined>();
  const has = (name: string) => def.filters.includes(name);

  const filters = useMemo(() => {
    const out: Record<string, string> = { ...presetRange(preset) } as Record<string, string>;
    for (const [k, v] of Object.entries(f)) if (v && has(k)) out[k] = v;
    return out;
  }, [preset, f, def.key]);

  const result = useQuery({
    queryKey: ['report', def.key, filters, cursor],
    placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await api.GET('/reports/{key}', { params: { path: { key: def.key }, query: { ...filters, limit: 100, ...(cursor ? { cursor } : {}) } } })),
  });

  const types = new Map(def.columns.map((c) => [c.key, c.type]));
  const show = (key: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return '—';
    switch (types.get(key)) {
      case 'money':
        return formatMoney(String(v));
      case 'percent':
        return `${Number(v).toFixed(1)}%`;
      case 'datetime':
        return formatDateTime(String(v), timeZone);
      case 'number':
        return Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 });
      default:
        return String(v);
    }
  };
  const set = (k: string, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setCursor(undefined);
  };
  const columns = (result.data?.columns ?? def.columns).map((c) => ({ key: c.key ?? '', label: c.label ?? '' }));
  const totals = result.data?.totals as Record<string, unknown> | undefined;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <Select className="h-8 w-auto text-xs" value={preset} onChange={(e) => (setPreset(e.target.value as DatePreset), setCursor(undefined))} aria-label="Period">
          {DATE_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </Select>
        {has('sourceId') ? (
          <Select className="h-8 w-auto text-xs" value={f.sourceId ?? ''} onChange={(e) => set('sourceId', e.target.value)} aria-label="Source">
            <option value="">All sources</option>
            {sources.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        ) : null}
        {has('campaignId') ? (
          <Select className="h-8 w-auto text-xs" value={f.campaignId ?? ''} onChange={(e) => set('campaignId', e.target.value)} aria-label="Campaign">
            <option value="">All campaigns</option>
            {campaigns.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        ) : null}
        {can('users.manage') && has('teamId') ? (
          <Select className="h-8 w-auto text-xs" value={f.teamId ?? ''} onChange={(e) => set('teamId', e.target.value)} aria-label="Team">
            <option value="">All teams</option>
            {teams.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        ) : null}
        {can('users.manage') && has('userId') ? (
          <Select className="h-8 w-auto text-xs" value={f.userId ?? ''} onChange={(e) => set('userId', e.target.value)} aria-label="Agent">
            <option value="">All agents</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </Select>
        ) : null}
        <span className="ml-auto" />
        {canExport ? <ExportButton reportKey={def.key} filters={filters} /> : null}
      </div>

      {result.error ? <Alert>{errorMessage(result.error)}</Alert> : null}
      {result.isLoading ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              {columns.map((c) => (
                <Th key={c.key}>{c.label}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(result.data?.rows ?? []).map((row, i) => (
              <Tr key={i}>
                {columns.map((c) => (
                  <Td key={c.key}>{show(c.key, (row as Record<string, unknown>)[c.key])}</Td>
                ))}
              </Tr>
            ))}
            {(result.data?.rows ?? []).length === 0 ? (
              <tr>
                <Td colSpan={columns.length} className="text-center text-muted-foreground">
                  No rows for these filters.
                </Td>
              </tr>
            ) : null}
            {totals && Object.keys(totals).length ? (
              <tr className="bg-primary/5 font-semibold">
                {columns.map((c, i) => (
                  <Td key={c.key}>{i === 0 && totals[c.key] === undefined ? 'Total' : totals[c.key] === undefined ? '' : show(c.key, totals[c.key])}</Td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </Table>
      )}
      {result.data?.page?.hasMore ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setCursor(result.data?.page?.nextCursor ?? undefined)}>
            Next page
          </Button>
        </div>
      ) : null}
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Totals here always match the Excel and CSV files. Every export is logged.</p>
    </div>
  );
}
