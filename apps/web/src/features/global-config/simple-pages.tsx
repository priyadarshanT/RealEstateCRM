'use client';

import { Alert, Badge, Button, Field, Input, Loading, Table, Td, Textarea, Th, Tr } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError, errorMessage, unwrap } from '@/core/api';
import { openDownload } from '@/core/files';
import { formatDateTime } from '@/core/format';
import { ImportDialog } from '@/features/leads/import-dialog';
import { TemplatesTab } from '@/features/messaging/templates-tab';
import { IntegrationTile, useIntegrations } from './integrations-section';
import { MarketingTab } from './marketing-tab';
import { SourcesCard } from './sources-reasons';
import { ConfigShell, Section } from './ui';

/** Global Configuration › Manage Source. */
export function SourcesPage() {
  return (
    <ConfigShell title="Manage Source" description="Manage lead sources and their quality score (used in the lead score).">
      <SourcesCard />
    </ConfigShell>
  );
}

/** Global Configuration › Manage Marketing: campaigns with daily ad spend, and events / roadshows. */
export function MarketingPage() {
  return (
    <ConfigShell title="Manage Marketing" description="Campaigns, ad spend and events used by the marketing reports.">
      <MarketingTab />
    </ConfigShell>
  );
}

/**
 * Global Configuration › Migration (§4): Excel template, mapping of every field (name, country, phone, email,
 * source, owner, status, substatus, project, budget, notes, created date), skip or update known leads, batch ID
 * with counts, rejected rows with the reason, and retry without duplicates.
 */
export function MigrationPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const batches = useQuery({
    queryKey: ['lead-imports'],
    queryFn: async () => unwrap(await api.GET('/leads/imports')).data,
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === 'importing') ? 3000 : false),
  });
  const retry = useMutation({
    mutationFn: async (id: string) => unwrap(await api.POST('/leads/imports/{id}/retry', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-imports'] }),
  });

  async function downloadTemplate() {
    setTemplateError(null);
    const res = await fetch('/api/v1/leads/imports/template');
    if (!res.ok) return setTemplateError(`The template could not be downloaded (${res.status}).`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lead-migration-template.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <ConfigShell title="Migration" description="Import previous CRM leads and data">
      <Section
        title="1. Prepare the file"
        description="Download the template, fill one row per lead and keep the column names. The second sheet lists the statuses and substatuses you can use. Owner is the agent's email or full name."
      >
        <Button variant="outline" onClick={() => void downloadTemplate()}>
          <Download className="size-4" /> Download Excel template
        </Button>
        {templateError ? <Alert className="mt-2">{templateError}</Alert> : null}
      </Section>
      <Section title="2. Upload, check and import" description="Map the columns, check the preview, choose to skip or update leads that already exist, then import.">
        <Button onClick={() => setOpen(true)}>
          <FileUp className="size-4" /> Upload file
        </Button>
      </Section>
      <Section title="Import batches" description="Every import with its batch ID and counts. A failed batch can be retried; rows already imported are not imported again.">
        {batches.isLoading ? <Loading /> : null}
        {batches.error || retry.error ? <Alert>{errorMessage(batches.error ?? retry.error)}</Alert> : null}
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Batch</Th>
                <Th>Started</Th>
                <Th>Status</Th>
                <Th>Rows</Th>
                <Th>New</Th>
                <Th>Updated / re-enquired</Th>
                <Th>Skipped</Th>
                <Th>Rejected</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(batches.data ?? []).map((b) => (
                <Tr key={b.id}>
                  <Td className="font-mono text-xs">{b.batchId}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(b.createdAt)}</Td>
                  <Td>
                    <Badge tone={b.status === 'completed' ? 'success' : b.status === 'failed' ? 'danger' : b.status === 'importing' ? 'info' : 'neutral'}>{b.status}</Badge>
                    {b.attempts && b.attempts > 1 ? <span className="ml-1 text-xs text-muted-foreground">({b.attempts} runs)</span> : null}
                    {b.status === 'failed' && b.errorDetail ? <p className="max-w-56 truncate text-xs text-danger" title={b.errorDetail}>{b.errorDetail}</p> : null}
                  </Td>
                  <Td className="tabular-nums">{b.rowsTotal ?? 0}</Td>
                  <Td className="tabular-nums">{b.rowsImported ?? 0}</Td>
                  <Td className="tabular-nums">{b.duplicateMode === 'update' ? (b.rowsUpdated ?? 0) : (b.rowsReEnquired ?? 0)}</Td>
                  <Td className="tabular-nums">{b.rowsSkipped ?? 0}</Td>
                  <Td className="tabular-nums">
                    {b.rowsRejected ?? 0}
                    {b.rejectedRowsFileId ? (
                      <Button variant="link" size="sm" onClick={() => void openDownload(b.rejectedRowsFileId!)}>
                        Error report
                      </Button>
                    ) : null}
                  </Td>
                  <Td>
                    {b.status === 'failed' ? (
                      <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(b.id)}>
                        <RotateCw className="size-3.5" /> Retry
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
              {batches.data?.length === 0 ? (
                <tr>
                  <Td colSpan={9} className="text-center text-muted-foreground">
                    No imports yet.
                  </Td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </div>
      </Section>
      <ImportDialog
        open={open}
        migration
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) void qc.invalidateQueries({ queryKey: ['lead-imports'] });
        }}
      />
    </ConfigShell>
  );
}

/** Communication › Templates: email and WhatsApp templates with variables and approval status. */
export function TemplatesPage() {
  return (
    <ConfigShell title="Templates" description="Email and WhatsApp templates with variables and approval status. SMS templates arrive with an SMS provider.">
      <TemplatesTab />
    </ConfigShell>
  );
}

/** Communication › Email Configuration: the company email sender, its display name, reply-to address and signature. */
export function EmailPage() {
  const list = useIntegrations();
  const sender = (list.data ?? []).find((i) => i.provider === 'email_ses' && i.status !== 'disconnected');
  return (
    <ConfigShell title="Email Configuration" description="The address the CRM sends email from, the reply-to address and the signature added to every email.">
      {list.isLoading ? <Loading /> : null}
      {list.error ? <Alert>{errorMessage(list.error)}</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <IntegrationTile
          card={{ key: 'email', name: 'Email sender', description: 'Company email for messages to leads', tab: 'others', mark: '@', tone: 'bg-sky-600 text-white', providers: ['email_ses'], connect: 'email' }}
          rows={(list.data ?? []).filter((i) => i.provider === 'email_ses')}
        />
        {sender ? (
          <EmailSettingsForm key={sender.id} sender={sender} />
        ) : (
          <Section title="Sender details">
            <p className="text-sm text-muted-foreground">Connect the email sender first; then set the sender name, reply-to address and signature here.</p>
          </Section>
        )}
      </div>
    </ConfigShell>
  );
}

function EmailSettingsForm({ sender }: { sender: Schemas['Integration'] }) {
  const qc = useQueryClient();
  const initial = { fromName: String(sender.settings?.fromName ?? ''), replyTo: String(sender.settings?.replyTo ?? ''), signature: String(sender.settings?.signature ?? '') };
  const [f, setF] = useState(initial);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const save = useMutation({
    mutationFn: async () => unwrap(await api.PATCH('/integrations/{id}', { params: { path: { id: sender.id } }, body: { settings: f } as unknown as Schemas['Integration'] })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
  const err = (field: string) => (save.error instanceof ApiError ? save.error.fieldError(`settings.${field}`) : undefined);
  return (
    <Section title="Sender details" description={`Emails go out from ${String(sender.settings?.fromAddress ?? sender.accountLabel)}.`}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Sender name" error={err('fromName')}>
          <Input maxLength={100} value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} placeholder="Alpha Ventura Real Estate" />
        </Field>
        <Field label="Reply-to address (empty = the sender address)" error={err('replyTo')}>
          <Input type="email" value={f.replyTo} onChange={(e) => setF({ ...f, replyTo: e.target.value })} placeholder="sales@yourcompany.ae" />
        </Field>
        <Field label="Signature (added below every email)" error={err('signature')}>
          <Textarea rows={5} maxLength={2000} value={f.signature} onChange={(e) => setF({ ...f, signature: e.target.value })} placeholder={'Kind regards,\nSales team\n+971 4 550 1200'} />
        </Field>
        {save.error && !(save.error instanceof ApiError && save.error.status === 400) ? <Alert>{errorMessage(save.error)}</Alert> : null}
        {save.isSuccess && !dirty ? <Alert tone="success">Saved.</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={!dirty || save.isPending} onClick={() => setF(initial)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!dirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Section>
  );
}
