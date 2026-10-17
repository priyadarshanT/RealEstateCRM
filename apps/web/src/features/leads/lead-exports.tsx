'use client';

import { Alert, Button, Dialog, DialogContent, cn } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { ExportTrackerButton as Tracker } from '@/features/list-tools/export-tracker';
import { LEAD_COLUMNS } from './columns';

// Export Leads and Export Tracker (Lead page §5–6).

const LABEL = new Map<string, string>(LEAD_COLUMNS.map((c) => [c.key, c.label]));

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

/** Export Tracker of lead exports. */
export function ExportTrackerButton({ canExport, openSignal }: { canExport: boolean; openSignal?: number }) {
  return <Tracker kind="lead" columnLabels={LABEL} canExport={canExport} openSignal={openSignal} />;
}
