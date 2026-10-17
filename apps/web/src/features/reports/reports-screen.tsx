'use client';

import { Alert, Button, EmptyState, Loading, Select, cn } from '@crm/ui';
import { ChevronLeft, ChevronRight, FileBarChart2 } from 'lucide-react';
import type { Schemas } from '@crm/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { DATE_PRESETS, presetRange, type DatePreset } from '@/core/date-range';
import { formatMoney } from '@/core/format';
import { useCampaigns, useProjectList, useSources, useTeams, useUsers } from '@/core/lookups';
import { useCan, useMe } from '@/core/session';
import { ExportButton } from './export-button';
import { ReportGrid } from './report-grid';
import { useClientPolicy } from '@/features/global-config/policy';

type Definition = Schemas['ReportDefinition'];

const MODULE_LABEL: Record<string, string> = { leads: 'Leads', marketing: 'Marketing', performance: 'Performance', events: 'Events', messaging: 'WhatsApp and email', integrations: 'Integrations', sales: 'Sales', finance: 'Finance', attendance: 'Attendance' };

/** Pick a report, filter by date, source, campaign, team and agent, and export (SRS §8). */
export function ReportsScreen() {
  const can = useCan();
  // Lead exports follow Global Configuration › Leads › Export Leads (the API checks it too).
  const policy = useClientPolicy();
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
      <div className="flex items-center gap-2">
        <FileBarChart2 className="size-5 text-primary" />
        <h1 className="text-lg font-semibold">
          Reports{current ? <span className="font-normal text-muted-foreground"> › {current.name}</span> : null}
        </h1>
      </div>
      <div className="grid gap-4 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <nav className="h-fit rounded-xl border border-border bg-surface p-2 shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          {groups.map(([module, items]) => (
            <div key={module} className="mb-2">
              <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase text-muted-foreground">{MODULE_LABEL[module] ?? module}</p>
              {items.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setKey(d.key)}
                  className={cn(
                    'block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors',
                    d.key === current?.key ? 'bg-primary font-medium text-primary-foreground shadow-sm' : 'text-foreground/80 hover:bg-muted',
                  )}
                >
                  {d.name}
                </button>
              ))}
            </div>
          ))}
        </nav>
        {current ? <ReportView key={current.key} def={current} canExport={current.module === 'attendance' ? can('attendance.export') : current.module === 'leads' ? can('leads.export') && policy.data?.exportLeads === true : can('reports.export')} timeZone={me.data?.user.timezone} /> : <EmptyState title="No reports" />}
      </div>
    </div>
  );
}

function ReportView({ def, canExport, timeZone }: { def: Definition; canExport: boolean; timeZone?: string }) {
  const can = useCan();
  const sources = useSources();
  const projects = useProjectList();
  const campaigns = useCampaigns();
  const teams = useTeams();
  const users = useUsers();
  const [preset, setPreset] = useState<DatePreset>('thisMonth');
  const [f, setF] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
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

  const set = (k: string, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setCursor(undefined);
    setHistory([]);
  };
  const typeOf = new Map(def.columns.map((c) => [c.key ?? '', c.type]));
  const columns = (result.data?.columns ?? def.columns).map((c) => ({ key: c.key ?? '', label: c.label ?? '', type: typeOf.get(c.key ?? '') }));
  const totals = result.data?.totals as Record<string, unknown> | undefined;
  const rows = (result.data?.rows ?? []) as Record<string, unknown>[];
  const total = (result.data?.page as { total?: number } | undefined)?.total;
  const start = history.length * 100;
  const types = new Map(columns.map((c) => [c.key, c.type]));
  const labelOf = new Map(columns.map((c) => [c.key, c.label]));
  // Totals as summary cards above the grid (lead lists have none; grouped and finance reports do).
  const summary = totals && Object.keys(totals).length > 1
    ? Object.entries(totals)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .slice(0, 6)
        .map(([k, v]) => ({
          label: labelOf.get(k) ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (x) => x.toUpperCase()),
          value: types.get(k) === 'money' ? formatMoney(String(v)) : types.get(k) === 'percent' ? `${Number(v).toFixed(1)}%` : typeof v === 'number' ? v.toLocaleString('en-US') : String(v),
        }))
    : [];

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2.5 shadow-sm">
        <Select className="h-8 w-auto text-xs" value={preset} onChange={(e) => (setPreset(e.target.value as DatePreset), setCursor(undefined), setHistory([]))} aria-label="Period">
          {DATE_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </Select>
        {has('projectId') ? (
          <Select className="h-8 w-auto text-xs" value={f.projectId ?? ''} onChange={(e) => set('projectId', e.target.value)} aria-label="Project">
            <option value="">All projects</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        ) : null}
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
        {result.data ? (
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            {(total ?? rows.length).toLocaleString('en-US')} {(total ?? rows.length) === 1 ? 'row' : 'rows'}
          </span>
        ) : null}
        {canExport ? <ExportButton reportKey={def.key} filters={filters} /> : null}
      </div>

      {summary.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {summary.map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
              <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className="mt-1 truncate text-lg font-semibold tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {result.error ? <Alert>{errorMessage(result.error)}</Alert> : null}
      {result.isLoading ? (
        <Loading />
      ) : (
        <ReportGrid columns={columns} rows={rows} totals={totals} timeZone={timeZone} loading={result.isFetching} />
      )}
      {history.length || result.data?.page?.hasMore ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {rows.length ? start + 1 : 0}–{start + rows.length}
            {total !== undefined ? ` of ${total.toLocaleString('en-US')}` : ''}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!history.length}
              onClick={() => {
                setCursor(history[history.length - 1]);
                setHistory((h) => h.slice(0, -1));
              }}
            >
              <ChevronLeft /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!result.data?.page?.hasMore}
              onClick={() => {
                setHistory((h) => [...h, cursor]);
                setCursor(result.data?.page?.nextCursor ?? undefined);
              }}
            >
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">Totals here always match the Excel and CSV files. Every export is logged.</p>
    </div>
  );
}
