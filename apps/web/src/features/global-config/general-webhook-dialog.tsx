'use client';

import { Alert, Button, Dialog, DialogContent, Field, Input, Select } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, errorMessage, unwrap } from '@/core/api';
import { useSources } from '@/core/lookups';

type Source = Schemas['WebhookSource'];

/** CRM fields an incoming field can fill (API: WebhookSource.fieldMapping keys). */
export const CRM_FIELD_LABEL: Record<string, string> = {
  fullName: 'Full name',
  firstName: 'First name',
  lastName: 'Last name',
  phonePrimary: 'Phone',
  phoneAlternate: 'Second phone',
  email: 'Email',
  preferredLanguage: 'Language',
  countryCode: 'Country',
  budgetMin: 'Budget from',
  budgetMax: 'Budget to',
  budgetCurrency: 'Currency',
  project: 'Project',
  note: 'Message / note',
  formName: 'Form or listing',
  externalId: 'Lead ID (stops duplicates)',
  externalCampaignId: 'Campaign ID',
};

type Row = { crm: string; incoming: string };
const STARTER: Row[] = [
  { crm: 'fullName', incoming: 'name' },
  { crm: 'phonePrimary', incoming: 'phone' },
  { crm: 'email', incoming: 'email' },
];

/**
 * General webhook (SRS §11.2): a secure link any system can send leads to. Create: name, lead source and field
 * mapping; the link and secret are shown once. Edit: change the mapping, or issue a new secret.
 */
export function GeneralWebhookDialog({
  open,
  existing,
  onClose,
}: {
  open: boolean;
  existing?: { integrationId: string; name: string; settings: Record<string, unknown> } | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const sources = useSources();
  const [name, setName] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [rows, setRows] = useState<Row[]>(STARTER);
  const [result, setResult] = useState<Source | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setCopied(null);
    if (existing) {
      setName(existing.name);
      setSourceId(String(existing.settings.sourceId ?? ''));
      const mapping = (existing.settings.fieldMapping as Record<string, string> | undefined) ?? {};
      setRows(Object.entries(mapping).map(([crm, incoming]) => ({ crm, incoming })));
    } else {
      setName('');
      setSourceId('');
      setRows(STARTER);
    }
  }, [open, existing]);

  const mapping = Object.fromEntries(rows.filter((r) => r.crm && r.incoming.trim()).map((r) => [r.crm, r.incoming.trim()]));
  const done = (s: Source) => {
    setResult(s);
    void qc.invalidateQueries({ queryKey: ['integrations'] });
  };
  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST('/webhook-sources', { body: { name: name.trim(), sourceId, fieldMapping: mapping } as Schemas['WebhookSource'] })),
    onSuccess: done,
  });
  const save = useMutation({
    mutationFn: async () => unwrap(await api.PUT('/webhook-sources/{id}/mapping', { params: { path: { id: existing!.integrationId } }, body: { fieldMapping: mapping } })),
    onSuccess: done,
  });
  const rotate = useMutation({
    mutationFn: async () => unwrap(await api.POST('/webhook-sources/{id}/rotate-secret', { params: { path: { id: existing!.integrationId } } })),
    onSuccess: done,
  });
  const error = create.error ?? save.error ?? rotate.error;
  const fieldError = (f: string) => (error instanceof ApiError ? error.fieldError(f) : undefined);
  const used = new Set(rows.map((r) => r.crm));

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  }

  function close() {
    create.reset();
    save.reset();
    rotate.reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title={existing ? `General webhook: ${existing.name}` : 'New general webhook'} wide>
        {result ? (
          <div className="space-y-3 text-sm">
            {result.secret ? (
              <Alert tone="warning">Copy the secret now. It is shown only once; if it is lost, issue a new one.</Alert>
            ) : (
              <Alert tone="success">Field mapping saved.</Alert>
            )}
            <Field label="Link to send leads to (POST, JSON)">
              <div className="flex gap-2">
                <Input readOnly value={result.inboundUrl ?? ''} className="font-mono text-xs" />
                <Button variant="outline" size="sm" onClick={() => copy(result.inboundUrl ?? '', 'url')}>
                  <Copy /> {copied === 'url' ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </Field>
            {result.secret ? (
              <Field label="Secret">
                <div className="flex gap-2">
                  <Input readOnly value={result.secret} className="font-mono text-xs" />
                  <Button variant="outline" size="sm" onClick={() => copy(result.secret!, 'secret')}>
                    <Copy /> {copied === 'secret' ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </Field>
            ) : null}
            <p className="text-muted-foreground">
              Send one lead per request as a JSON object. Sign each request: header <code className="rounded bg-muted px-1">X-Signature</code> = HMAC-SHA256 of the body with the
              secret (hex). Optional <code className="rounded bg-muted px-1">X-Event-Id</code> stops the same row being imported twice.
            </p>
            <div className="flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (existing) save.mutate();
              else create.mutate();
            }}
          >
            <p className="text-sm text-muted-foreground">For the website, Google Sheets (Apps Script), Excel (Power Automate), Make.com or any other tool. Every request becomes a lead.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name *" error={fieldError('name')}>
                <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!!existing} placeholder="Google Sheet: Creek leads" />
              </Field>
              <Field label="Lead source *" error={fieldError('sourceId')}>
                <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={!!existing}>
                  <option value="">Choose…</option>
                  {sources.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Field mapping: incoming field name → CRM field (nested fields as contact.phone)</p>
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    className="h-8"
                    value={r.incoming}
                    placeholder="incoming field"
                    aria-label="Incoming field"
                    onChange={(e) => setRows((x) => x.map((row, j) => (j === i ? { ...row, incoming: e.target.value } : row)))}
                  />
                  <span className="text-muted-foreground">→</span>
                  <Select className="h-8" value={r.crm} aria-label="CRM field" onChange={(e) => setRows((x) => x.map((row, j) => (j === i ? { ...row, crm: e.target.value } : row)))}>
                    {Object.entries(CRM_FIELD_LABEL).map(([k, label]) => (
                      <option key={k} value={k} disabled={k !== r.crm && used.has(k)}>
                        {label}
                      </option>
                    ))}
                  </Select>
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setRows((x) => [...x, { crm: Object.keys(CRM_FIELD_LABEL).find((k) => !used.has(k)) ?? 'note', incoming: '' }])}
              >
                <Plus /> Add field
              </Button>
              {fieldError('fieldMapping') ? <p className="text-xs text-danger">{fieldError('fieldMapping')}</p> : null}
            </div>
            {error && !(error instanceof ApiError && error.status === 400) ? <Alert>{errorMessage(error)}</Alert> : null}
            {error instanceof ApiError && error.status === 400 && !fieldError('fieldMapping') && !fieldError('name') && !fieldError('sourceId') ? <Alert>{errorMessage(error)}</Alert> : null}
            <div className="flex flex-wrap justify-end gap-2">
              {existing ? (
                <Button type="button" variant="outline" disabled={rotate.isPending} onClick={() => window.confirm('Issue a new secret? The old one stops working at once.') && rotate.mutate()}>
                  New secret
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || save.isPending || (!existing && (!name.trim() || !sourceId))}>
                {existing ? 'Save mapping' : 'Create link'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
