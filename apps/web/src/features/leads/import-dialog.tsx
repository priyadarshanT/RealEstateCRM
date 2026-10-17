'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Field, Input, Select, Table, Td, Th, Tr } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { openDownload, uploadFile } from '@/core/files';
import { useSources } from '@/core/lookups';

type Import = Schemas['LeadImport'];
type PreviewRow = { row: number; values: Record<string, string>; status: 'ok' | 'rejected'; errors: string[] };

const FIELDS: { key: string; label: string }[] = [
  { key: 'fullName', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'phoneAlternate', label: 'Alternate phone' },
  { key: 'email', label: 'Email' },
  { key: 'countryCode', label: 'Country' },
  { key: 'preferredLanguage', label: 'Language' },
  { key: 'budgetMin', label: 'Budget min' },
  { key: 'budgetMax', label: 'Budget max' },
  { key: 'budgetCurrency', label: 'Currency' },
  { key: 'formName', label: 'Form' },
  { key: 'note', label: 'Note' },
  { key: 'submittedAt', label: 'Enquiry date' },
  { key: 'externalSubmissionId', label: 'Row / submission ID' },
];

/** Extra columns of a migration from another CRM (Global Configuration › Migration). */
const MIGRATION_FIELDS: { key: string; label: string }[] = [
  { key: 'source', label: 'Source' },
  { key: 'owner', label: 'Owner (email or name)' },
  { key: 'status', label: 'Status' },
  { key: 'substatus', label: 'Substatus' },
  { key: 'project', label: 'Project' },
  { key: 'createdDate', label: 'Created date' },
];

/**
 * Excel / CSV import (SRS §2.4): preview with phone and email checks, column mapping, rejected rows with the
 * reason, then import. Existing phones or emails become re-enquiries, never duplicates; the same row ID is never imported twice.
 */
export function ImportDialog({ open, onOpenChange, migration = false }: { open: boolean; onOpenChange: (v: boolean) => void; migration?: boolean }) {
  // A migration chooses what happens to leads that already exist; the lead page import adds a re-enquiry.
  const [duplicateMode, setDuplicateMode] = useState<'re_enquiry' | 'skip' | 'update'>(migration ? 'skip' : 're_enquiry');
  const fields = migration ? [...FIELDS, ...MIGRATION_FIELDS] : FIELDS;
  const qc = useQueryClient();
  const sources = useSources();
  const importSource = sources.data?.find((s) => s.type === 'import');
  const [file, setFile] = useState<File | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [fileId, setFileId] = useState<string | null>(null);
  const [job, setJob] = useState<Import | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const preview = useMutation({
    mutationFn: async (withMapping: boolean) => {
      const id = fileId ?? (await uploadFile(file!, 'import'));
      setFileId(id);
      return unwrap(
        await api.POST('/leads/imports', {
          body: { fileId: id, sourceId: sourceId || importSource!.id, duplicateMode, ...(withMapping ? { mapping } : {}) },
        }),
      );
    },
    onSuccess: (j) => {
      setJob(j);
      setMapping(j.mapping as Record<string, string>);
    },
  });

  const confirm = useMutation({
    mutationFn: async () => {
      let j = unwrap(await api.POST('/leads/imports/{id}/confirm', { params: { path: { id: job!.id } } }));
      for (let i = 0; i < 120 && j.status === 'importing'; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        j = unwrap(await api.GET('/leads/imports/{id}', { params: { path: { id: j.id } } }));
        setJob(j);
      }
      return j;
    },
    onSuccess: (j) => {
      setJob(j);
      void qc.invalidateQueries({ queryKey: ['leads'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  function close() {
    setFile(null);
    setFileId(null);
    setJob(null);
    setMapping({});
    preview.reset();
    confirm.reset();
    onOpenChange(false);
  }

  const rows = (job?.preview ?? []) as PreviewRow[];
  const headers = rows[0] ? Object.keys(rows[0].values) : [];
  const rejected = rows.filter((r) => r.status === 'rejected').length;
  const finished = job && (job.status === 'completed' || job.status === 'failed');

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent title={migration ? 'Migrate leads from your previous CRM' : 'Import leads from Excel or CSV'} wide>
        <div className="space-y-4">
          {!job ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="File (.xlsx or .csv)">
                <Input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </Field>
              <Field label="Source for these leads">
                <Select value={sourceId || importSource?.id || ''} onChange={(e) => setSourceId(e.target.value)}>
                  {sources.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                {migration ? <span className="text-xs text-muted-foreground">Used when the file has no Source column, or the row leaves it empty.</span> : null}
              </Field>
              {migration ? (
                <Field label="Leads that already exist (same phone or email)" className="sm:col-span-2">
                  <Select value={duplicateMode} onChange={(e) => setDuplicateMode(e.target.value as 'skip' | 'update')}>
                    <option value="skip">Skip them (keep the CRM as it is)</option>
                    <option value="update">Update them with the file&apos;s values</option>
                  </Select>
                </Field>
              ) : null}
              <div className="flex justify-end sm:col-span-2">
                <Button disabled={!file || preview.isPending} onClick={() => preview.mutate(false)}>
                  {preview.isPending ? 'Reading file…' : 'Preview'}
                </Button>
              </div>
            </div>
          ) : null}

          {job && !finished && job.status === 'previewing' ? (
            <>
              <p className="text-sm">
                {job.rowsTotal} rows in the file. Preview of the first {rows.length}: <Badge tone="success">{rows.length - rejected} ok</Badge>{' '}
                {rejected ? <Badge tone="danger">{rejected} rejected</Badge> : null}
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {fields.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <Select className="h-8 text-xs" value={mapping[f.key] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}>
                      <option value="">— not in file —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={preview.isPending}
                  onClick={() => {
                    setMapping((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v)));
                    preview.mutate(true);
                  }}
                >
                  Re-check with this mapping
                </Button>
              </div>
              <Table>
                <thead>
                  <tr>
                    <Th>Row</Th>
                    {headers.map((h) => (
                      <Th key={h}>{h}</Th>
                    ))}
                    <Th>Check</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Tr key={r.row} className={r.status === 'rejected' ? 'bg-danger/5' : undefined}>
                      <Td>{r.row}</Td>
                      {headers.map((h) => (
                        <Td key={h} className="text-xs">
                          {r.values[h]}
                        </Td>
                      ))}
                      <Td className="text-xs">{r.status === 'ok' ? <Badge tone="success">ok</Badge> : <span className="text-danger">{r.errors.join('; ')}</span>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </>
          ) : null}

          {job && (job.status === 'importing' || finished) ? (
            <Alert tone={job.status === 'failed' ? 'danger' : job.status === 'completed' ? 'success' : 'info'}>
              {job.status === 'importing' ? 'Importing… ' : job.status === 'failed' ? 'The import failed. ' : 'Import finished. '}
              {job.duplicateMode && job.duplicateMode !== 're_enquiry'
                ? `${job.rowsImported ?? 0} new leads, ${job.rowsUpdated ?? 0} updated, ${job.rowsSkipped ?? 0} skipped, ${job.rowsRejected ?? 0} rejected.`
                : `${job.rowsImported ?? 0} new leads, ${job.rowsReEnquired ?? 0} re-enquiries, ${job.rowsRejected ?? 0} rejected.`}
              {job.batchId ? <span className="ml-1 font-mono text-xs">({job.batchId})</span> : null}
              {job.rejectedRowsFileId ? (
                <Button variant="link" size="sm" className="ml-2" onClick={() => void openDownload(job.rejectedRowsFileId!)}>
                  Download rejected rows
                </Button>
              ) : null}
            </Alert>
          ) : null}

          {preview.error || confirm.error ? <Alert>{errorMessage(preview.error ?? confirm.error)}</Alert> : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close}>
              {finished ? 'Close' : 'Cancel'}
            </Button>
            {job?.status === 'previewing' ? (
              <Button disabled={confirm.isPending || rows.length === rejected} onClick={() => confirm.mutate()}>
                Import {job.rowsTotal} rows
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
