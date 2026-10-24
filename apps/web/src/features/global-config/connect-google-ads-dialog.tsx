'use client';

import { Alert, Button, Dialog, DialogContent, Field, Input, Select } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError, errorMessage, unwrap } from '@/core/api';
import { useSources } from '@/core/lookups';

/**
 * Google Ads lead form extensions (SRS §11): Google posts each lead to our webhook URL with the key set on the form.
 * The Admin chooses the key here, then pastes the URL and the same key into Google Ads (lead form → Lead delivery →
 * Webhook integration). The key goes to the secret store and is never shown again.
 */
export function ConnectGoogleAdsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const sources = useSources();
  const [key, setKey] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [connected, setConnected] = useState<{ webhookUrl: string; key: string } | null>(null);
  const connect = useMutation({
    mutationFn: async () => {
      const settings = { sharedSecret: key.trim(), ...(sourceId ? { sourceId } : {}) };
      const { integrationId } = unwrap(await api.POST('/integrations', { body: { provider: 'google_ads', scope: 'tenant', settings } as Schemas['IntegrationConnect'] }));
      const row = unwrap(await api.GET('/integrations/{id}', { params: { path: { id: integrationId } } }));
      return { webhookUrl: String(row.settings?.webhookUrl ?? ''), key: key.trim() };
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['integrations'] });
      setConnected(r);
    },
  });
  const err = (field: string) => (connect.error instanceof ApiError ? connect.error.fieldError(`settings.${field}`) : undefined);
  const googleSources = sources.data?.filter((s) => s.type === 'google_ads') ?? [];

  function close() {
    setKey('');
    setSourceId('');
    setConnected(null);
    connect.reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title="Connect Google Ads lead forms">
        {connected ? (
          <div className="space-y-3 text-sm">
            <Alert tone="success">Connected. Now add the webhook in Google Ads.</Alert>
            <p>In Google Ads, open the lead form → Lead delivery → Webhook integration, and paste:</p>
            <Field label="Webhook URL">
              <Input readOnly value={connected.webhookUrl} onFocus={(e) => e.target.select()} />
            </Field>
            <Field label="Key">
              <Input readOnly value={connected.key} onFocus={(e) => e.target.select()} />
            </Field>
            <p className="text-xs text-muted-foreground">Then click &quot;Send test data&quot; in Google Ads: a test lead appears in the CRM. The key is not shown again.</p>
            <div className="flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              connect.mutate();
            }}
          >
            <Field label="Key * (at least 16 characters; you enter the same key in Google Ads)" error={err('sharedSecret')}>
              <Input autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
            </Field>
            <Field label="Lead source" error={err('sourceId')}>
              <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                <option value="">Google Ads lead forms (created automatically)</option>
                {googleSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            {connect.error && !(connect.error instanceof ApiError && connect.error.status === 400) ? <Alert>{errorMessage(connect.error)}</Alert> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={connect.isPending || key.trim().length < 16}>
                Connect
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
