'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Loading, Table, Td, Th, Tr } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, History, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { formatDateTime } from '@/core/format';

type Export = Schemas['LeadExport'];
const STATUS_TONE = { queued: 'neutral', processing: 'info', ready: 'success', failed: 'danger', expired: 'neutral' } as const;
const STATUS_LABEL = { queued: 'Queued', processing: 'Processing', ready: 'Ready', failed: 'Failed', expired: 'Expired' } as const;

/**
 * Export Tracker (Lead and Project pages): the export history with status, record count and Download Excel /
 * Retry. The button shows only the number of export jobs the user can see; the history opens on click.
 */
export function ExportTrackerButton({ kind, columnLabels, canExport, openSignal }: { kind: 'lead' | 'project'; columnLabels: Map<string, string>; canExport: boolean; openSignal?: number }) {
  const base = kind === 'lead' ? '/lead-exports' : '/project-exports';
  const queryKey = [kind === 'lead' ? 'lead-exports' : 'project-exports'];
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [lastSignal, setLastSignal] = useState(openSignal);
  if (openSignal !== lastSignal) {
    setLastSignal(openSignal);
    if (openSignal) setOpen(true);
  }
  const list = useQuery({
    queryKey,
    queryFn: async () => unwrap(await api.GET(base, { params: { query: { limit: 50 } } })),
    refetchInterval: (q) => (open && q.state.data?.data.some((e) => e.status === 'queued' || e.status === 'processing') ? 2500 : false),
  });
  const download = useMutation({
    mutationFn: async (id: string) => unwrap(await api.POST(`${base}/{id}/download` as '/lead-exports/{id}/download', { params: { path: { id } } })),
    onSuccess: (link) => {
      window.open(link.url, '_blank', 'noopener');
      void qc.invalidateQueries({ queryKey });
    },
  });
  const retry = useMutation({
    mutationFn: async (id: string) => unwrap(await api.POST(`${base}/{id}/retry` as '/lead-exports/{id}/retry', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
  const pending = list.data?.data.filter((e) => e.status === 'queued' || e.status === 'processing').length ?? 0;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <History /> Export Tracker
        {list.data ? (
          <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary">{list.data.page.total ?? list.data.data.length}</span>
        ) : list.error ? (
          // The count could not load: show that instead of a wrong zero; the history dialog offers Retry.
          <span className="rounded-full bg-danger/10 px-1.5 text-xs text-danger" title="Count could not load">
            !
          </span>
        ) : (
          <span className="px-1.5 text-xs text-muted-foreground">…</span>
        )}
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
                  <Th>{kind === 'lead' ? 'Lead count' : 'Project count'}</Th>
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
                    <Td className="max-w-48 text-xs">{e.columns.map((c) => columnLabels.get(c) ?? c).join(', ')}</Td>
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
  if (typeof f.selectedProjects === 'number') return `${f.selectedProjects} projects chosen`;
  const parts = Object.entries(f).map(([k, v]) => `${k}: ${String(v)}`);
  return parts.length ? parts.join(' · ') : 'No filters';
}
