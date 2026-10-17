'use client';

import {
  Alert,
  Button,
  Checkbox,
  EmptyState,
  Loading,
  TabStrip,
  Table,
  Td,
  Th,
  Tr,
  cn,
} from '@crm/ui';
import { CalendarDays, CalendarPlus, Eye, EyeOff, List, Plus, Upload } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { formatDate, formatDateTime, formatRelativeDay, initials } from '@/core/format';
import { byId, useCampaigns, useColleagues, useProjectList, useSources, useStages, useSubstatuses } from '@/core/lookups';
import { useCan, useMe } from '@/core/session';
import { useClientPolicy } from '@/features/global-config/policy';
import { DateRangeControl, type DateRangeValue } from '@/features/list-tools/date-range-control';
import { ManageColumnsButton, useListColumns } from '@/features/list-tools/manage-columns';
import { ExportLeadsButton, ExportTrackerButton } from './lead-exports';
import { LeadsCalendar } from './leads-calendar';
import { ScheduleDialog } from '@/features/calendar/schedule-dialog';
import { BulkBar } from './bulk-bar';
import { DEFAULT_COLUMNS, LEAD_COLUMNS, LEAD_DATE_FIELDS, LEAD_TABS, STATUS_TABS, type LeadColumnKey } from './columns';
import { EMPTY_FILTERS, LeadFilters, type LeadFilterState } from './lead-filters';
import { useLeadList, type Lead, type LeadQuery, type LeadTab } from './leads-api';
import { ImportDialog } from './import-dialog';
import { NewLeadDialog } from './new-lead-dialog';
import { SavedFiltersMenu } from './saved-filters-menu';
import { PriorityBadge, ScoreBadge, StageBadge } from './stage-badge';

const COUNTS_KEY = 'crm.leads.showCounts';

/** Builds GET /leads query parameters from the tab and filters on screen. */
function toQuery(tab: LeadTab, f: LeadFilterState, q: string, range: DateRangeValue): LeadQuery {
  const query: LeadQuery = { tab, sort: '-score,nextFollowUpAt' };
  if (q) query.q = q;
  if (range.from || range.to) {
    query.dateField = range.field as LeadQuery['dateField'];
    if (range.from) query.dateFrom = range.from;
    if (range.to) query.dateTo = range.to;
  }
  for (const k of ['sourceId', 'projectId', 'campaignId', 'ownerUserId', 'teamId', 'stageId', 'budgetMin', 'budgetMax'] as const) {
    if (f[k]) (query as Record<string, unknown>)[k] = f[k];
  }
  return query;
}

export function LeadsListScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const can = useCan();
  const me = useMe();
  const policy = useClientPolicy();
  const tz = me.data?.user.timezone;

  // Dashboard drill-down links arrive as query parameters (e.g. ?stageId=… or ?tab=overdue).
  const [tab, setTab] = useState<LeadTab>((params.get('tab') as LeadTab) ?? 'all');
  const [filters, setFilters] = useState<LeadFilterState>(() => ({
    ...EMPTY_FILTERS,
    ...Object.fromEntries(['sourceId', 'projectId', 'campaignId', 'ownerUserId', 'teamId', 'stageId'].flatMap((k) => (params.get(k) ? [[k, params.get(k)]] : []))),
  }));
  const [search, setSearch] = useState('');
  const [savedName, setSavedName] = useState<string | null>(null);
  const [range, setRange] = useState<DateRangeValue>({ field: 'created' });
  const listColumns = useListColumns('leads', [...LEAD_COLUMNS], DEFAULT_COLUMNS);
  const columns = listColumns.columns as LeadColumnKey[];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | undefined>();
  const [rows, setRows] = useState<Lead[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [trackerSignal, setTrackerSignal] = useState(0);
  const [mode, setMode] = useState<'list' | 'calendar'>('list');
  const [scheduleFor, setScheduleFor] = useState<Lead | null>(null);
  // Show Lead Counts: remembered for the browser session.
  const [showCounts, setShowCounts] = useState(false);
  useEffect(() => {
    try {
      setShowCounts(window.sessionStorage.getItem(COUNTS_KEY) === '1');
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggleCounts = () =>
    setShowCounts((v) => {
      try {
        window.sessionStorage.setItem(COUNTS_KEY, v ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !v;
    });

  const baseQuery = useMemo(() => toQuery(tab, filters, search, range), [tab, filters, search, range]);
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
  const substatuses = byId(useSubstatuses().data);
  const sources = byId(useSources().data);
  const campaigns = byId(useCampaigns().data);
  const projects = byId(useProjectList().data);
  const users = byId(useColleagues().data);

  const counts = useQuery({
    queryKey: ['lead-status-counts', baseQuery],
    enabled: showCounts,
    queryFn: async () => {
      const { tab: _tab, sort: _sort, ...rest } = baseQuery;
      return unwrap(await api.GET('/leads/status-counts', { params: { query: rest } })).data;
    },
  });
  const countOf = new Map((counts.data ?? []).map((c) => [c.key, c.count]));

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
      case 'phone':
        return <span className="font-mono text-xs">{lead.phonePrimary ?? '—'}</span>;
      case 'substatus':
        return lead.substatusId ? <span className="text-xs">{substatuses.get(lead.substatusId)?.name ?? '—'}</span> : <span className="text-muted-foreground">—</span>;
      case 'secondaryOwner':
        return lead.secondaryOwnerUserId ? <span className="text-xs">{users.get(lead.secondaryOwnerUserId)?.fullName ?? '—'}</span> : '—';
      // Latest move between agents (stakeholder update: who had the lead, who made the move, when).
      case 'assignedFrom': {
        const a = lead.lastAssignment;
        if (!a) return '—';
        return <span className="text-xs">{a.fromUserId ? (users.get(a.fromUserId)?.fullName ?? '—') : 'Unassigned'}</span>;
      }
      case 'reassignedBy': {
        const a = lead.lastAssignment;
        if (!a) return '—';
        return <span className="text-xs">{a.byUserId ? (users.get(a.byUserId)?.fullName ?? '—') : `System · ${a.method.replace(/_/g, ' ')}`}</span>;
      }
      case 'reassignedAt':
        return lead.lastAssignment ? <span className="whitespace-nowrap text-xs">{formatDateTime(lead.lastAssignment.at)}</span> : '—';
      case 'campaign':
        return lead.campaignId ? <span className="text-xs">{campaigns.get(lead.campaignId)?.name ?? '—'}</span> : '—';
      case 'email':
        return lead.email ?? '—';
      case 'project': {
        const id = lead.primaryProjectId ?? lead.projectIds?.[0];
        return id ? <span className="text-xs">{projects.get(id)?.name ?? '—'}</span> : '—';
      }
      case 'country':
        return lead.countryCode ?? '—';
      case 'city':
        return lead.city ?? '—';
      case 'source':
        return <span className="text-xs text-muted-foreground">{sources.get(lead.sourceId)?.name ?? '—'}</span>;
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
        return <StageBadge stage={stages.get(lead.stageId)} substatus={!columns.includes('substatus') && lead.substatusId ? substatuses.get(lead.substatusId)?.name : undefined} />;
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

  const visible = columns.map((k) => LEAD_COLUMNS.find((c) => c.key === k)!).filter(Boolean);
  const total = list.data?.page.total;
  const exportFilters = Object.fromEntries(Object.entries(baseQuery).filter(([, v]) => v !== undefined && v !== ''));

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Leads</h1>
      <TabStrip
        items={LEAD_TABS.map((t) => ({
          key: t.key,
          label: t.label,
          ...(showCounts && STATUS_TABS.includes(t.key) && counts.data ? { count: countOf.get(t.key) ?? 0 } : t.key === tab && total !== undefined && !STATUS_TABS.includes(t.key) ? { count: total } : {}),
        }))}
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
            if (v.columns.length) void listColumns.save.mutateAsync(v.columns);
            setSavedName(name);
          }}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {can('leads.import') ? (
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload /> Import
            </Button>
          ) : null}
          {can('leads.create') ? (
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus /> New lead
            </Button>
          ) : null}
        </div>
      </div>

      {/* Lead page toolbar (stakeholder update §9): Show Lead Counts, Calendar / Date Range, Manage Columns, Export Leads, Export Tracker. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2">
        <Button variant={showCounts ? 'primary' : 'outline'} size="sm" onClick={toggleCounts} aria-pressed={showCounts}>
          {showCounts ? <EyeOff /> : <Eye />} {showCounts ? 'Hide Lead Counts' : 'Show Lead Counts'}
        </Button>
        <DateRangeControl fields={LEAD_DATE_FIELDS} value={range} onChange={setRange} />
        <ManageColumnsButton
          all={[...LEAD_COLUMNS]}
          value={columns}
          defaults={DEFAULT_COLUMNS}
          onApply={(keys) => listColumns.save.mutateAsync(keys)}
          onReset={() => listColumns.reset.mutateAsync()}
          error={listColumns.save.error ?? listColumns.reset.error}
        />
        {can('leads.export') && policy.data?.exportLeads ? (
          <ExportLeadsButton selectedIds={[...selected]} filteredCount={total} filters={exportFilters} columns={columns} onQueued={() => setTrackerSignal((n) => n + 1)} />
        ) : null}
        <ExportTrackerButton canExport={can('leads.export') && !!policy.data?.exportLeads} openSignal={trackerSignal} />
        <div className="ml-auto inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="View">
          <button type="button" onClick={() => setMode('list')} aria-pressed={mode === 'list'} className={cn('inline-flex items-center gap-1 px-2.5 py-1 text-xs', mode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
            <List className="size-3.5" /> List
          </button>
          <button type="button" onClick={() => setMode('calendar')} aria-pressed={mode === 'calendar'} className={cn('inline-flex items-center gap-1 px-2.5 py-1 text-xs', mode === 'calendar' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
            <CalendarDays className="size-3.5" /> Calendar
          </button>
        </div>
        {showCounts && counts.isLoading ? <span className="text-xs text-muted-foreground">Counting…</span> : null}
        {showCounts && counts.error ? (
          <span className="text-xs text-danger">
            Counts could not load.{' '}
            <button type="button" className="underline" onClick={() => void counts.refetch()}>
              Retry
            </button>
          </span>
        ) : null}
      </div>

      {selected.size ? <BulkBar ids={[...selected]} deletedTab={tab === 'deleted'} onDone={() => setSelected(new Set())} /> : null}

      {mode === 'calendar' ? <LeadsCalendar query={baseQuery} timeZone={tz} /> : null}
      {mode === 'list' && list.error ? <Alert>{errorMessage(list.error)}</Alert> : null}
      {mode === 'calendar' ? null : list.isLoading ? (
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
              <Th className="w-10" />
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
                <Td>
                  {/* Lead page §3.1–3.4: Schedule on Hot and Warm rows only. */}
                  {lead.stageCategory === 'open' && !lead.deletedAt && lead.access !== 'view' && can('leads.edit') ? (
                    <Button variant="ghost" size="icon" aria-label={`Schedule with ${lead.fullName}`} title="Schedule" onClick={() => setScheduleFor(lead)}>
                      <CalendarPlus />
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {mode === 'list' && !list.isLoading && rows.length === 0 && !list.error ? <EmptyState title="No leads here">Try another tab or clear the filters.</EmptyState> : null}
      {mode === 'list' && list.data?.page.hasMore ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={list.isFetching} onClick={() => setCursor(list.data?.page.nextCursor ?? undefined)}>
            {list.isFetching ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}

      <ScheduleDialog open={!!scheduleFor} leadId={scheduleFor?.id ?? ''} leadName={scheduleFor?.fullName ?? ''} onClose={() => setScheduleFor(null)} />
      <NewLeadDialog open={newOpen} onOpenChange={setNewOpen} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
