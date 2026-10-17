'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Loading, Table, Td, Th, Tr, cn } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, History, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { formatDateTime } from '@/core/format';
import { LEAD_COLUMNS } from './columns';

// Export Leads and Export Tracker (Lead page §5–6).

type Export = Schemas['LeadExport'];
const LABEL = new Map<string, string>(LEAD_COLUMNS.map((c) => [c.key, c.label]));
const STATUS_TONE = { queued: 'neutral', processing: 'info', ready: 'success', failed: 'danger', expired: 'neutral' } as const;
const STATUS_LABEL = { queued: 'Queued', processing: 'Processing', ready: 'Ready', failed: 'Failed', expired: 'Expired' } as const;

/** Export Leads: Selected Leads or All Filtered Leads, with the number of leads, then the file is made in the background. */
export function ExportLeadsButton({
  selectedIds,
  filteredCount,
  filters,
  columns,
  onQueued,
}: {
  selectedIds: string[];
  filteredCount: number | undefined;
  filters: Record<string, unknown>;
  columns: string[];
  onQueued: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'selected' | 'filtered'>('filtered');
  const count = scope === 'selected' ? selectedIds.length : filteredCount;
  const send = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/lead-exports', {
          body: { scope, columns, ...(scope === 'selected' ? { leadIds: selectedIds } : { filters }) },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead-exports'] });
      setOpen(false);
      onQueued();
    },
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setScope(selectedIds.length ? 'selected' : 'filtered');
          send.reset();
          setOpen(true);
        }}
      >
        <FileSpreadsheet /> Export Leads
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Export Leads">
          <div className="space-y-3">
            <fieldset className="space-y-2">
              <label className={cn('flex items-center gap-2 text-sm', !selectedIds.length && 'opacity-50')}>
                <input type="radio" name="scope" disabled={!selectedIds.length} checked={scope === 'selected'} onChange={() => setScope('selected')} />
                Selected Leads ({selectedIds.length})
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="scope" checked={scope === 'filtered'} onChange={() => setScope('filtered')} />
                All Filtered Leads ({filteredCount ?? '…'})
              </label>
            </fieldset>
            <p className="text-sm text-muted-foreground">
              Excel file with your visible columns in their order: {columns.map((c) => LABEL.get(c) ?? c).join(', ')}. Hidden contact details stay hidden in the file.
            </p>
            {send.error ? <Alert>{errorMessage(send.error)}</Alert> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={send.isPending || !count} onClick={() => send.mutate()}>
                {send.isPending ? 'Requesting…' : `Export ${count ?? ''} leads`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Export Tracker: the export history with status, record count and Download Excel / Retry. */
export function ExportTrackerButton({ canExport, openSignal }: { canExport: boolean; openSignal?: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [lastSignal, setLastSignal] = useState(openSignal);
  if (openSignal !== lastSignal) {
    setLastSignal(openSignal);
    if (openSignal) setOpen(true);
  }
  const list = useQuery({
    queryKey: ['lead-exports'],
    queryFn: async () => unwrap(await api.GET('/lead-exports', { params: { query: { limit: 50 } } })),
    refetchInterval: (q) => (open && q.state.data?.data.some((e) => e.status === 'queued' || e.status === 'processing') ? 2500 : false),
  });
  const download = useMutation({
    mutationFn: async (id: string) => unwrap(await api.POST('/lead-exports/{id}/download', { params: { path: { id } } })),
    onSuccess: (link) => {
      window.open(link.url, '_blank', 'noopener');
      void qc.invalidateQueries({ queryKey: ['lead-exports'] });
    },
  });
  const retry = useMutation({
    mutationFn: async (id: string) => unwrap(await api.POST('/lead-exports/{id}/retry', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-exports'] }),
  });
  const pending = list.data?.data.filter((e) => e.status === 'queued' || e.status === 'processing').length ?? 0;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <History /> Export Tracker
        {list.data ? <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary">{list.data.page.total ?? list.data.data.length}</span> : null}
        {pending ? <span className="size-2 animate-pulse rounded-full bg-amber-500" aria-label="Exports in progress" /> : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Export Tracker" wide>
          {list.isLoading ? <Loading /> : null}
          {list.error ? (
            <Alert>
              {errorMessage(list.error)}{' '}
              <Button variant="link" size="sm" onClick={() => void list.refetch()}>
                Retry
              </Button>
            </Alert>
          ) : null}
          {download.error || retry.error ? <Alert>{errorMessage(download.error ?? retry.error)}</Alert> : null}
          <div className="max-h-[65vh] overflow-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Export</Th>
                  <Th>Exported by</Th>
                  <Th>Requested</Th>
                  <Th>Scope</Th>
                  <Th>Columns</Th>
                  <Th>Records</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {(list.data?.data ?? []).map((e: Export) => (
                  <Tr key={e.id}>
                    <Td>
                      <p className="font-mono text-xs">{e.exportId}</p>
                      <p className="max-w-48 truncate text-xs text-muted-foreground" title={e.fileName ?? ''}>
                        {e.fileName ?? '—'}
                      </p>
                    </Td>
                    <Td className="text-xs">{e.exportedByName ?? '—'}</Td>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(e.requestedAt)}</Td>
                    <Td className="text-xs">
                      {e.scope === 'selected' ? 'Selected' : 'All filtered'}
                      <p className="max-w-48 truncate text-muted-foreground" title={JSON.stringify(e.filters)}>
                        {describeFilters(e.filters)}
                      </p>
                    </Td>
                    <Td className="max-w-48 text-xs">{e.columns.map((c) => LABEL.get(c) ?? c).join(', ')}</Td>
                    <Td className="tabular-nums">{e.recordCount ?? '—'}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
                      {e.status === 'failed' && e.errorDetail ? <p className="max-w-40 truncate text-xs text-danger" title={e.errorDetail}>{e.errorDetail}</p> : null}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {e.status === 'ready' && canExport ? (
                        <Button size="sm" variant="outline" disabled={download.isPending} onClick={() => download.mutate(e.id)}>
                          <Download className="size-3.5" /> Download Excel
                        </Button>
                      ) : null}
                      {e.status === 'failed' && canExport ? (
                        <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(e.id)}>
                          <RotateCw className="size-3.5" /> Retry
                        </Button>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
                {list.data?.data.length === 0 ? (
                  <tr>
                    <Td colSpan={8} className="text-center text-muted-foreground">
                      No exports yet.
                    </Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function describeFilters(f: Record<string, unknown>): string {
  if (typeof f.selectedLeads === 'number') return `${f.selectedLeads} leads chosen`;
  const parts = Object.entries(f).map(([k, v]) => `${k}: ${String(v)}`);
  return parts.length ? parts.join(' · ') : 'No filters';
}
