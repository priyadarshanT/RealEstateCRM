'use client';

import { Alert, Button, Dropdown, DropdownContent, DropdownItem, DropdownTrigger, Spinner } from '@crm/ui';
import { useMutation } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';

type Format = 'xlsx' | 'csv';

/**
 * Excel / CSV export of a report with the filters on screen (SRS §8.1, §8.9–10).
 * The API builds the file in the background and logs the export; we wait for it and open the download link.
 */
export function ExportButton({ reportKey, filters, label = 'Export' }: { reportKey: string; filters: Record<string, unknown>; label?: string }) {
  const [message, setMessage] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async (format: Format) => {
      setMessage(null);
      let job = unwrap(await api.POST('/reports/{key}/exports', { params: { path: { key: reportKey } }, body: { format, filters } }));
      for (let i = 0; i < 60 && (job.status === 'queued' || job.status === 'running'); i++) {
        await new Promise((r) => setTimeout(r, 1500));
        job = unwrap(await api.GET('/exports/{id}', { params: { path: { id: job.id } } }));
      }
      if (job.status === 'completed' && job.downloadUrl) {
        window.open(job.downloadUrl, '_blank', 'noopener');
        return job;
      }
      if (job.status === 'failed') throw new Error('The export failed. Please try again.');
      setMessage('The export is still being prepared. You will be notified when it is ready.');
      return job;
    },
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <Dropdown>
        <DropdownTrigger asChild>
          <Button variant="outline" size="sm" disabled={run.isPending}>
            {run.isPending ? <Spinner /> : <Download />} {label}
          </Button>
        </DropdownTrigger>
        <DropdownContent align="end">
          <DropdownItem onSelect={() => run.mutate('xlsx')}>Excel (.xlsx)</DropdownItem>
          <DropdownItem onSelect={() => run.mutate('csv')}>CSV</DropdownItem>
        </DropdownContent>
      </Dropdown>
      {run.error ? <Alert className="max-w-sm">{errorMessage(run.error)}</Alert> : null}
      {message ? <Alert tone="info" className="max-w-sm">{message}</Alert> : null}
    </div>
  );
}
