'use client';

import {
  Alert,
  Button,
  Checkbox,
  Dropdown,
  DropdownCheckboxItem,
  DropdownContent,
  DropdownTrigger,
  EmptyState,
  Loading,
  TabStrip,
  Table,
  Td,
  Th,
  Tr,
  cn,
} from '@crm/ui';
import { Columns3, Plus, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/core/api';
import { presetRange } from '@/core/date-range';
import { formatDate, formatRelativeDay, initials } from '@/core/format';
import { byId, useCampaigns, useColleagues, useSources, useStages } from '@/core/lookups';
import { useCan, useMe } from '@/core/session';
import { ExportButton } from '@/features/reports/export-button';
import { BulkBar } from './bulk-bar';
import { DEFAULT_COLUMNS, LEAD_COLUMNS, LEAD_TABS, type LeadColumnKey } from './columns';
import { EMPTY_FILTERS, LeadFilters, type LeadFilterState } from './lead-filters';
import { useLeadList, type Lead, type LeadQuery, type LeadTab } from './leads-api';
import { ImportDialog } from './import-dialog';
import { NewLeadDialog } from './new-lead-dialog';
import { SavedFiltersMenu } from './saved-filters-menu';
import { PriorityBadge, ScoreBadge, StageBadge } from './stage-badge';

const COLUMNS_KEY = 'crm.leads.columns';

function loadColumns(): LeadColumnKey[] {
  try {
    const raw = window.localStorage.getItem(COLUMNS_KEY);
    return raw ? (JSON.parse(raw) as LeadColumnKey[]) : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

/** Builds GET /leads query parameters from the tab and filters on screen. */
function toQuery(tab: LeadTab, f: LeadFilterState, q: string): LeadQuery {
  const { from, to } = presetRange(f.datePreset);
  const query: LeadQuery = { tab, sort: '-score,nextFollowUpAt' };
  if (q) query.q = q;
  if (from) query.createdFrom = from;
  if (to) query.createdTo = to;
  for (const k of ['sourceId', 'campaignId', 'ownerUserId', 'teamId', 'stageId', 'budgetMin', 'budgetMax'] as const) {
    if (f[k]) (query as Record<string, unknown>)[k] = f[k];
  }
  return query;
}

export function LeadsListScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const can = useCan();
  const me = useMe();
  const tz = me.data?.user.timezone;

  // Dashboard drill-down links arrive as query parameters (e.g. ?stageId=… or ?tab=overdue).
  const [tab, setTab] = useState<LeadTab>((params.get('tab') as LeadTab) ?? 'all');
  const [filters, setFilters] = useState<LeadFilterState>(() => ({
    ...EMPTY_FILTERS,
    ...Object.fromEntries(['sourceId', 'campaignId', 'ownerUserId', 'teamId', 'stageId'].flatMap((k) => (params.get(k) ? [[k, params.get(k)]] : []))),
  }));
  const [search, setSearch] = useState('');
  const [savedName, setSavedName] = useState<string | null>(null);
  const [columns, setColumns] = useState<LeadColumnKey[]>(DEFAULT_COLUMNS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | undefined>();
  const [rows, setRows] = useState<Lead[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => setColumns(loadColumns()), []);
  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(columns));
    } catch {
      /* storage unavailable: columns reset next visit */
    }
  }, [columns]);

  const baseQuery = useMemo(() => toQuery(tab, filters, search), [tab, filters, search]);
  const list = useLeadList({ ...baseQuery, ...(cursor ? { cursor } : {}) });

  // Reset paging and selection whenever the query changes.
  useEffect(() => {
    setCursor(undefined);
    setRows([]);
    setSelected(new Set());
  }, [baseQuery]);
  useEffect(() => {
    if (!list.data || list.isPlaceholderData) return;
    setRows((prev) => (cursor ? [...prev, ...list.data.data.filter((l) => !prev.some((p) => p.id === l.id))] : list.data.data));
  }, [list.data, list.isPlaceholderData, cursor]);

  const stages = byId(useStages().data);
  const sources = byId(useSources().data);
  const campaigns = byId(useCampaigns().data);
  const users = byId(useColleagues().data);

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someChecked = rows.some((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const now = Date.now();
  const cell = (lead: Lead, key: LeadColumnKey) => {
    switch (key) {
      case 'name':
        return (
          <Link href={`/leads/${lead.id}`} className="block">
            <span className="font-semibold hover:text-primary">{lead.fullName}</span>
            <span className="block text-xs text-muted-foreground">{lead.phonePrimary ?? ''}</span>
          </Link>
        );
      case 'email':
        return lead.email ?? '—';
      case 'country':
        return lead.countryCode ?? '—';
      case 'source':
        return (
          <span className="text-xs text-muted-foreground">
            {sources.get(lead.sourceId)?.name ?? '—'}
            {lead.campaignId ? ` · ${campaigns.get(lead.campaignId)?.name ?? ''}` : ''}
          </span>
        );
      case 'agent': {
        const owner = lead.ownerUserId ? users.get(lead.ownerUserId) : undefined;
        if (!lead.ownerUserId) return <span className="text-xs text-muted-foreground">Unassigned</span>;
        return (
          <span title={owner?.fullName} className="inline-flex size-7 items-center justify-center rounded-full bg-info/10 text-xs font-semibold text-info">
            {initials(owner?.fullName ?? (lead.ownerUserId === me.data?.user.id ? me.data.user.fullName : '?'))}
          </span>
        );
      }
      case 'priority':
        return <PriorityBadge priority={lead.priority} />;
      case 'score':
        return <ScoreBadge score={lead.score} />;
      case 'stage':
        return <StageBadge stage={stages.get(lead.stageId)} />;
      case 'latestNote':
        return <span className="line-clamp-2 max-w-56 text-xs">{lead.latestNote ?? '—'}</span>;
      case 'nextFollowUp': {
        const overdue = lead.nextFollowUpAt && Date.parse(lead.nextFollowUpAt) < now && lead.stageCategory === 'open';
        return <span className={cn('text-sm', overdue && 'font-medium text-danger')}>{formatRelativeDay(lead.nextFollowUpAt, tz)}</span>;
      }
      case 'createdAt':
        return formatDate(lead.createdAt, tz);
    }
  };

  const visible = LEAD_COLUMNS.filter((c) => columns.includes(c.key));
  const total = list.data?.page.total;
  const exportFilters = Object.fromEntries(
    Object.entries({ ...presetRange(filters.datePreset), ...filters, datePreset: undefined }).filter(([, v]) => v),
  );

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Leads</h1>
      <TabStrip
        items={LEAD_TABS.map((t) => ({ key: t.key, label: t.label, ...(t.key === tab && total !== undefined ? { count: total } : {}) }))}
        value={tab}
        onChange={(k) => {
          setTab(k as LeadTab);
          setSavedName(null);
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-8 w-56 rounded-md border border-border bg-surface px-2 text-xs"
          placeholder="Filter by name, phone, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Filter leads"
        />
        <LeadFilters
          value={filters}
          onChange={(v) => {
            setFilters(v);
            setSavedName(null);
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SavedFiltersMenu
          activeName={savedName}
          current={{ filters: { tab, ...filters }, columns }}
          onApply={(name, v) => {
            const { tab: savedTab, ...rest } = v.filters as { tab?: LeadTab } & Partial<LeadFilterState>;
            if (savedTab) setTab(savedTab);
            setFilters({ ...EMPTY_FILTERS, ...rest });
            if (v.columns.length) setColumns(v.columns as LeadColumnKey[]);
            setSavedName(name);
          }}
        />
        <div className="ml-auto flex items-start gap-2">
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 /> Columns
              </Button>
            </DropdownTrigger>
            <DropdownContent align="end">
              {LEAD_COLUMNS.map((c) => (
                <DropdownCheckboxItem
                  key={c.key}
                  checked={columns.includes(c.key)}
                  disabled={c.key === 'name'}
                  onCheckedChange={(on) => setColumns((cols) => (on ? LEAD_COLUMNS.map((x) => x.key).filter((k) => k === c.key || cols.includes(k)) : cols.filter((k) => k !== c.key)))}
                >
                  {c.label}
                </DropdownCheckboxItem>
              ))}
            </DropdownContent>
          </Dropdown>
          {can('leads.import') ? (
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload /> Import
            </Button>
          ) : null}
          {can('reports.export') ? <ExportButton reportKey="leads" filters={exportFilters} /> : null}
          {can('leads.create') ? (
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus /> New lead
            </Button>
          ) : null}
        </div>
      </div>

      {selected.size ? <BulkBar ids={[...selected]} deletedTab={tab === 'deleted'} onDone={() => setSelected(new Set())} /> : null}

      {list.error ? <Alert>{errorMessage(list.error)}</Alert> : null}
      {list.isLoading ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-8">
                <Checkbox
                  aria-label="Select all"
                  checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                  onCheckedChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </Th>
              {visible.map((c) => (
                <Th key={c.key}>{c.label}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((lead) => (
              <Tr key={lead.id} className="cursor-pointer" onClick={(e) => (e.target as HTMLElement).closest('button,a') || router.push(`/leads/${lead.id}`)}>
                <Td>
                  <Checkbox aria-label={`Select ${lead.fullName}`} checked={selected.has(lead.id)} onCheckedChange={() => toggle(lead.id)} />
                </Td>
                {visible.map((c) => (
                  <Td key={c.key}>{cell(lead, c.key)}</Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {!list.isLoading && rows.length === 0 && !list.error ? <EmptyState title="No leads here">Try another tab or clear the filters.</EmptyState> : null}
      {list.data?.page.hasMore ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={list.isFetching} onClick={() => setCursor(list.data?.page.nextCursor ?? undefined)}>
            {list.isFetching ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}

      <NewLeadDialog open={newOpen} onOpenChange={setNewOpen} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
