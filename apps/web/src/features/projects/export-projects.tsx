'use client';

import { Alert, Button, Dialog, DialogContent, cn } from '@crm/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';

/**
 * Export Projects (Project page §4): Selected Projects or All Filtered Projects with the count shown first; an Excel
 * file with the visible columns in order (custom fields included). A second click while sending is ignored.
 */
export function ExportProjectsButton({
  selectedIds,
  filteredCount,
  filters,
  columns,
  columnLabels,
  onQueued,
}: {
  selectedIds: string[];
  filteredCount: number | undefined;
  filters: Record<string, unknown>;
  columns: string[];
  columnLabels: Map<string, string>;
  onQueued: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'selected' | 'filtered'>('filtered');
  const sending = useRef(false);
  const count = scope === 'selected' ? selectedIds.length : filteredCount;
  const send = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/project-exports', {
          body: { scope, columns, ...(scope === 'selected' ? { projectIds: selectedIds } : { filters }) },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project-exports'] });
      setOpen(false);
      onQueued();
    },
    onSettled: () => {
      sending.current = false;
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
        <FileSpreadsheet /> Export Projects
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Export Projects">
          <div className="space-y-3">
            <fieldset className="space-y-2">
              <label className={cn('flex items-center gap-2 text-sm', !selectedIds.length && 'opacity-50')}>
                <input type="radio" name="scope" disabled={!selectedIds.length} checked={scope === 'selected'} onChange={() => setScope('selected')} />
                Selected Projects ({selectedIds.length})
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="scope" checked={scope === 'filtered'} onChange={() => setScope('filtered')} />
                All Filtered Projects ({filteredCount ?? '…'})
              </label>
            </fieldset>
            <p className="text-sm text-muted-foreground">Excel file with your visible columns in order: {columns.map((c) => columnLabels.get(c) ?? c).join(', ')}.</p>
            {send.error ? <Alert>{errorMessage(send.error)}</Alert> : null}
            {send.isSuccess ? <Alert tone="success">Export requested. It appears in the Export Tracker.</Alert> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={send.isPending || !count}
                onClick={() => {
                  if (sending.current) return;
                  sending.current = true;
                  send.mutate();
                }}
              >
                {send.isPending ? 'Requesting…' : `Export ${count ?? ''} projects`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
