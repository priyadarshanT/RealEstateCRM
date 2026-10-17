'use client';

import { Alert, Badge, Button, Checkbox, Dialog, DialogContent, EmptyState, Field, Input, Loading, Select, Table, Td, Th, Tr, cn } from '@crm/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Filter, Pencil, Plus, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, errorMessage, unwrap } from '@/core/api';
import { formatDate, formatMoney } from '@/core/format';
import { byId, useUsers } from '@/core/lookups';
import { useCan, useMe } from '@/core/session';
import { DateRangeControl, type DateRangeValue } from '@/features/list-tools/date-range-control';
import { ExportTrackerButton } from '@/features/list-tools/export-tracker';
import { ManageColumnsButton, useListColumns } from '@/features/list-tools/manage-columns';
import { CustomFieldsButton, useCustomFields } from './custom-fields-dialog';
import { ExportProjectsButton } from './export-projects';
import { allProjectColumns, CATEGORY_LABEL, CATEGORY_TABS, DEFAULT_PROJECT_COLUMNS, PROJECT_DATE_FIELDS, type CustomField } from './project-columns';
import { CONSTRUCTION_LABEL, Project, useDevelopers, useProjectActions } from './projects-api';

type Category = (typeof CATEGORY_TABS)[number]['key'];
const PAGE_SIZES = [10, 25, 50, 100];

/**
 * Project page (stakeholder update 2026-10-17): category tabs with counts, search, Manage Columns (custom fields
 * included), Calendar / Date Range, filters, Export Projects, Export Tracker with its count, Show Entries and row
 * selection. Search, filters, dates, category and paging work together without losing the chosen columns.
 */
export function ProjectsScreen() {
  const can = useCan();
  const me = useMe();
  const router = useRouter();
  const [category, setCategory] = useState<Category>('all');
  const [q, setQ] = useState('');
  const [developerId, setDeveloperId] = useState('');
  const [status, setStatus] = useState('');
  const [assignedUserId, setAssignedUserId] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [range, setRange] = useState<DateRangeValue>({ field: 'created' });
  const [pageSize, setPageSize] = useState(25);
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<'project' | 'developer' | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [trackerSignal, setTrackerSignal] = useState(0);

  const developers = useDevelopers();
  const devName = new Map((developers.data ?? []).map((d) => [d.id, d.name]));
  const users = byId(useUsers().data);
  const fields = useCustomFields();
  const all = allProjectColumns(fields.data);
  const label = new Map(all.map((c) => [c.key, c.label]));
  const listColumns = useListColumns('projects', all, DEFAULT_PROJECT_COLUMNS);
  const columns = listColumns.columns;
  const fieldOf = new Map((fields.data ?? []).map((f) => [`cf:${f.key}`, f]));

  // Filters shared by the list, the category counts and All Filtered Projects exports.
  const filters = useMemo(
    () => ({
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(developerId ? { developerId } : {}),
      ...(status ? { constructionStatus: status as Project['constructionStatus'] } : {}),
      ...(assignedUserId ? { assignedUserId } : {}),
      ...(showInactive ? {} : { isActive: true }),
      ...(range.from || range.to ? { dateField: range.field as 'created' | 'updated' | 'handover', ...(range.from ? { dateFrom: range.from } : {}), ...(range.to ? { dateTo: range.to } : {}) } : {}),
    }),
    [q, developerId, status, assignedUserId, showInactive, range],
  );
  const listQuery = useMemo(() => ({ ...filters, ...(category !== 'all' ? { category } : {}) }), [filters, category]);
  const filterCount = [developerId, status, assignedUserId, showInactive ? 'x' : ''].filter(Boolean).length;

  useEffect(() => {
    setCursor(undefined);
    setHistory([]);
    setSelected(new Set());
  }, [listQuery, pageSize]);

  const list = useQuery({
    queryKey: ['projects', 'page', listQuery, pageSize, cursor],
    placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await api.GET('/projects', { params: { query: { ...listQuery, limit: pageSize, total: true, ...(cursor ? { cursor } : {}) } } })),
  });
  const counts = useQuery({
    queryKey: ['projects', 'category-counts', filters],
    queryFn: async () => unwrap(await api.GET('/projects/category-counts', { params: { query: filters } })),
  });
  const rows = list.data?.data ?? [];
  const leadCounts = useQuery({
    queryKey: ['projects', 'lead-counts', rows.map((r) => r.id).join(',')],
    enabled: rows.length > 0 && columns.includes('leadCount'),
    queryFn: async () => unwrap(await api.GET('/leads/project-counts', { params: { query: { projectIds: rows.map((r) => r.id).join(',') } } })).data,
  });
  const leadCountOf = new Map((leadCounts.data ?? []).map((c) => [c.projectId, c.count]));
  const total = list.data?.page.total;
  const start = history.length * pageSize;
  const countOf = (key: Category) => (key === 'all' ? counts.data?.total : counts.data?.data.find((c) => c.category === key)?.count);

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const cell = (p: Project, key: string) => {
    const field = fieldOf.get(key);
    if (field) return customValue(field, p.customValues?.[field.key]);
    const inv = p.inventory;
    const units = (inv?.available ?? 0) + (inv?.onHold ?? 0) + (inv?.booked ?? 0) + (inv?.sold ?? 0);
    switch (key) {
      case 'availability':
        return units ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
            <span className={cn('size-2 rounded-full', inv!.available ? 'bg-emerald-500' : 'bg-slate-300')} />
            {inv!.available ? `${inv!.available} of ${units} available` : 'Sold out'}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No units</span>
        );
      case 'name':
        return (
          <Link href={`/projects/${p.id}`} className="font-medium hover:text-primary">
            {p.name}
          </Link>
        );
      case 'assignedTo':
        return p.assignedUserId ? <span className="text-xs">{users.get(p.assignedUserId)?.fullName ?? '—'}</span> : <span className="text-xs text-muted-foreground">—</span>;
      case 'category':
        return <span className="text-xs">{CATEGORY_LABEL[p.category ?? 'residential']}</span>;
      case 'status':
        return <Badge tone={p.isActive ? 'primary' : 'neutral'}>{p.isActive ? CONSTRUCTION_LABEL[p.constructionStatus] : 'Inactive'}</Badge>;
      case 'leadCount':
        return leadCounts.isLoading ? <span className="text-xs text-muted-foreground">…</span> : <span className="tabular-nums">{leadCountOf.get(p.id) ?? 0}</span>;
      case 'developer':
        return devName.get(p.developerId) ?? '—';
      case 'city':
        return p.city ?? '—';
      case 'location':
        return <span className="text-xs">{[p.community, p.address].filter(Boolean).join(', ') || '—'}</span>;
      case 'startingPrice':
        return p.startingPrice ? <span className="tabular-nums">{formatMoney(p.startingPrice.amount, p.startingPrice.currency)}</span> : '—';
      case 'currency':
        return p.startingPrice?.currency ?? '—';
      case 'paymentPlan':
        return p.paymentPlan ?? '—';
      case 'handoverDate':
        return p.handoverDate ? formatDate(p.handoverDate, 'UTC') : '—';
      case 'createdAt':
        return p.createdAt ? formatDate(p.createdAt, me.data?.user.timezone) : '—';
      case 'updatedAt':
        return p.updatedAt ? formatDate(p.updatedAt, me.data?.user.timezone) : '—';
      case 'notes':
        return <span className="line-clamp-2 max-w-64 text-xs">{p.description ?? '—'}</span>;
      default:
        return '—';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Projects</h1>
        <span className="ml-auto" />
        {can('projects.manage') ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setCreating('developer')}>
              <Plus /> Developer
            </Button>
            <Button size="sm" onClick={() => setCreating('project')}>
              <Plus /> New project
            </Button>
          </>
        ) : null}
      </div>

      <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
        {CATEGORY_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={category === t.key}
            onClick={() => setCategory(t.key)}
            className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', category === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {t.label}
            <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{counts.isLoading ? '…' : counts.error ? '!' : (countOf(t.key) ?? 0)}</span>
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-muted-foreground">{Object.keys(filters).length > 1 || q ? 'Counts follow your search and filters' : 'Projects you can see'}</span>
      </div>

      {/* Toolbar (Project page §1.3): Search, Manage Columns, Calendar / Date Range, Filter, Export Projects, Export Tracker, Show Entries. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2">
        <Input className="h-8 w-56" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
        <ManageColumnsButton
          all={all}
          value={columns}
          defaults={DEFAULT_PROJECT_COLUMNS}
          onApply={(keys) => listColumns.save.mutateAsync(keys)}
          onReset={() => listColumns.reset.mutateAsync()}
          error={listColumns.save.error ?? listColumns.reset.error}
        />
        {can('settings.manage') ? <CustomFieldsButton /> : null}
        <DateRangeControl fields={PROJECT_DATE_FIELDS} value={range} onChange={setRange} />
        <Button variant={filterCount ? 'primary' : 'outline'} size="sm" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen}>
          <Filter /> Filter{filterCount ? ` (${filterCount})` : ''}
        </Button>
        {can('projects.export') ? (
          <ExportProjectsButton
            selectedIds={[...selected]}
            filteredCount={total}
            filters={listQuery}
            columns={columns}
            columnLabels={label}
            onQueued={() => setTrackerSignal((n) => n + 1)}
          />
        ) : null}
        <ExportTrackerButton kind="project" columnLabels={label} canExport={can('projects.export')} openSignal={trackerSignal} />
        <span className="ml-auto flex items-center gap-2 text-xs">
          Show
          <Select className="h-8 w-auto text-xs" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Show entries">
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          entries
          <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => void Promise.all([list.refetch(), counts.refetch(), leadCounts.refetch()])}>
            <RefreshCw className={cn(list.isFetching && 'animate-spin')} />
          </Button>
        </span>
        {filtersOpen ? (
          <div className="flex w-full flex-wrap items-center gap-2 border-t border-border pt-2">
            <Select className="h-8 w-auto text-xs" value={developerId} onChange={(e) => setDeveloperId(e.target.value)} aria-label="Developer">
              <option value="">All developers</option>
              {developers.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select className="h-8 w-auto text-xs" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">Any status</option>
              {Object.entries(CONSTRUCTION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <Select className="h-8 w-auto text-xs" value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)} aria-label="Assigned to">
              <option value="">Anyone assigned</option>
              {[...users.values()].map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
            </label>
            {filterCount ? (
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  setDeveloperId('');
                  setStatus('');
                  setAssignedUserId('');
                  setShowInactive(false);
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {list.error ? <Alert>{errorMessage(list.error)}</Alert> : null}
      {list.isLoading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <thead>
              <tr>
                <Th className="w-8">
                  <Checkbox aria-label="Select all" checked={allChecked ? true : rows.some((r) => selected.has(r.id)) ? 'indeterminate' : false} onCheckedChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} />
                </Th>
                {columns.map((c) => (
                  <Th key={c} className="whitespace-nowrap">
                    {label.get(c) ?? c}
                  </Th>
                ))}
                <Th className="w-20">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Checkbox aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                  </Td>
                  {columns.map((c) => (
                    <Td key={c}>{cell(p, c)}</Td>
                  ))}
                  <Td className="whitespace-nowrap">
                    <Button variant="link" size="sm" onClick={() => router.push(`/projects/${p.id}`)}>
                      Open
                    </Button>
                    {can('projects.manage') ? (
                      <Button variant="ghost" size="icon" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                        <Pencil />
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {rows.length === 0 && !list.error ? <EmptyState title="No projects match">Try another category, a longer date range or fewer filters.</EmptyState> : null}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          Showing {rows.length ? start + 1 : 0}–{start + rows.length}
          {total !== undefined ? ` of ${total}` : ''}
          {selected.size ? ` · ${selected.size} selected` : ''}
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
            disabled={!list.data?.page.hasMore}
            onClick={() => {
              setHistory((h) => [...h, cursor]);
              setCursor(list.data?.page.nextCursor ?? undefined);
            }}
          >
            Next <ChevronRight />
          </Button>
        </div>
      </div>

      <DeveloperDialog open={creating === 'developer'} onClose={() => setCreating(null)} />
      <ProjectDialog open={creating === 'project'} onClose={() => setCreating(null)} onSaved={(p) => router.push(`/projects/${p.id}`)} />
      {editing ? <ProjectDialog open project={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function customValue(field: CustomField, v: unknown) {
  if (v === undefined || v === null || v === '') return <span className="text-muted-foreground">—</span>;
  if (field.fieldType === 'checkbox') return v ? 'Yes' : 'No';
  if (field.fieldType === 'date') return formatDate(String(v), 'UTC');
  return String(v);
}

function DeveloperDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createDeveloper } = useProjectActions();
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const err = (k: string) => (createDeveloper.error instanceof ApiError ? createDeveloper.error.fieldError(k) : undefined);
  const close = () => {
    setF({});
    createDeveloper.reset();
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title="New developer">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
            if (await createDeveloper.mutateAsync(body).catch(() => null)) close();
          }}
        >
          <Field label="Name *" error={err('name')} className="sm:col-span-2">
            <Input value={f.name ?? ''} onChange={set('name')} placeholder="Emaar Properties" />
          </Field>
          <Field label="Contact person">
            <Input value={f.contactName ?? ''} onChange={set('contactName')} />
          </Field>
          <Field label="VAT number (TRN)">
            <Input value={f.trn ?? ''} onChange={set('trn')} />
          </Field>
          <Field label="Email" error={err('email')}>
            <Input type="email" value={f.email ?? ''} onChange={set('email')} />
          </Field>
          <Field label="Phone" error={err('phone')}>
            <Input value={f.phone ?? ''} onChange={set('phone')} placeholder="+971 4 123 4567" />
          </Field>
          <Field label="Website" className="sm:col-span-2">
            <Input value={f.website ?? ''} onChange={set('website')} />
          </Field>
          {createDeveloper.error && !(createDeveloper.error instanceof ApiError && createDeveloper.error.status === 400) ? <Alert className="sm:col-span-2">{errorMessage(createDeveloper.error)}</Alert> : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={createDeveloper.isPending || !f.name?.trim()}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** New project, or edit an existing one. */
export function ProjectDialog({ open, onClose, project, onSaved }: { open: boolean; onClose: () => void; project?: Project; onSaved?: (p: Project) => void }) {
  const { createProject, updateProject } = useProjectActions();
  const developers = useDevelopers();
  const users = useUsers();
  const fields = useCustomFields();
  const [f, setF] = useState<Record<string, string>>({});
  // Custom field values being edited (Project page §2.8): only changed keys are sent.
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const customOf = (key: string) => (key in custom ? custom[key] : project?.customValues?.[key]);
  const value = (k: keyof Project) => f[k] ?? (project?.[k] === null || project?.[k] === undefined ? '' : String(project[k]));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = project ? updateProject : createProject;
  const err = (k: string) => (save.error instanceof ApiError ? save.error.fieldError(k) : undefined);
  const close = () => {
    setF({});
    setCustom({});
    save.reset();
    onClose();
  };

  async function submit() {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) {
      if (k === 'isActive') body[k] = v === 'true';
      else body[k] = v.trim() === '' ? (project ? null : undefined) : v.trim();
    }
    if (Object.keys(custom).length) body.customValues = custom;
    const saved = await (project ? updateProject.mutateAsync({ id: project.id, ...body }) : createProject.mutateAsync(body)).catch(() => null);
    if (saved) {
      onSaved?.(saved);
      close();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title={project ? 'Edit project' : 'New project'} wide>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Name *" error={err('name')}>
            <Input value={value('name')} onChange={set('name')} />
          </Field>
          <Field label="Developer *" error={err('developerId')}>
            <Select value={value('developerId')} onChange={set('developerId')}>
              <option value="">Choose…</option>
              {developers.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Community">
            <Input value={value('community')} onChange={set('community')} placeholder="Dubai Creek Harbour" />
          </Field>
          <Field label="City">
            <Input value={value('city') || (project ? '' : 'Dubai')} onChange={set('city')} />
          </Field>
          <Field label="Project type">
            <Select value={value('category') || 'residential'} onChange={set('category')}>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assigned to" error={err('assignedUserId')}>
            <Select value={value('assignedUserId')} onChange={set('assignedUserId')}>
              <option value="">Nobody</option>
              {users.data
                ?.filter((u) => u.status === 'active')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Build status">
            <Select value={value('constructionStatus') || 'off_plan'} onChange={set('constructionStatus')}>
              {Object.entries(CONSTRUCTION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Handover date" error={err('handoverDate')}>
            <Input type="date" value={value('handoverDate')} onChange={set('handoverDate')} />
          </Field>
          <Field label="Payment plan">
            <Input value={value('paymentPlan')} onChange={set('paymentPlan')} placeholder="80/20" />
          </Field>
          <Field label="Address">
            <Input value={value('address')} onChange={set('address')} />
          </Field>
          {project ? (
            <Field label="Active">
              <Select value={value('isActive')} onChange={set('isActive')}>
                <option value="true">Active (shown to agents)</option>
                <option value="false">Inactive</option>
              </Select>
            </Field>
          ) : null}
          {(fields.data ?? [])
            .filter((cf) => cf.isActive)
            .map((cf) => {
              const v = customOf(cf.key);
              const error = save.error instanceof ApiError ? save.error.fieldError(`customValues.${cf.key}`) : undefined;
              const put = (x: unknown) => setCustom((c) => ({ ...c, [cf.key]: x }));
              return (
                <Field key={cf.id} label={`${cf.label}${cf.isRequired ? ' *' : ''}`} error={error}>
                  {cf.fieldType === 'dropdown' ? (
                    <Select value={v === undefined || v === null ? '' : String(v)} onChange={(e) => put(e.target.value || null)}>
                      <option value="">—</option>
                      {cf.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : cf.fieldType === 'checkbox' ? (
                    <label className="flex h-9 items-center gap-2 text-sm">
                      <input type="checkbox" checked={v === true} onChange={(e) => put(e.target.checked)} /> Yes
                    </label>
                  ) : (
                    <Input
                      type={cf.fieldType === 'number' ? 'number' : cf.fieldType === 'date' ? 'date' : 'text'}
                      value={v === undefined || v === null ? '' : String(v)}
                      onChange={(e) => put(e.target.value === '' ? null : cf.fieldType === 'number' ? Number(e.target.value) : e.target.value)}
                    />
                  )}
                </Field>
              );
            })}
          <Field label="Description" className="sm:col-span-2">
            <textarea className="min-h-20 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" value={value('description')} onChange={set('description')} />
          </Field>
          {save.error && !(save.error instanceof ApiError && save.error.status === 400) ? <Alert className="sm:col-span-2">{errorMessage(save.error)}</Alert> : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || (!project && (!f.name?.trim() || !f.developerId))}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
