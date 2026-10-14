'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Loading, Table, Td, Th, Tr } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { formatDateTime } from '@/core/format';
import { ConnectPortalDialog, PORTALS } from './connect-portal-dialog';
import { ConnectSenderDialog } from './connect-sender-dialog';
import { GeneralWebhookDialog } from './general-webhook-dialog';
import { MetaCheckDialog } from './meta-check-dialog';

type Integration = Schemas['Integration'];

const LABEL: Partial<Record<Integration['provider'], string>> = {
  meta: 'Meta lead ads',
  whatsapp_cloud: 'WhatsApp (Meta, direct)',
  email_ses: 'Email sender',
  webhook: 'General webhook',
  website: 'Website',
  google_workspace: 'Google (Calendar and Meet)',
  microsoft_365: 'Microsoft 365 (Calendar and Teams)',
  ...PORTALS,
};

const STATUS_TONE = { connected: 'success', pending: 'warning', error: 'danger', disconnected: 'neutral' } as const;

/**
 * Connections (SRS §11.1–11.4, wireframe "Settings and integrations"): Meta lead ads, property portals, the general
 * webhook, the WhatsApp Business number and the email sender. Each row: status, last sync, records, failures,
 * Test / Retry / Disconnect; the general webhook also edits its mapping, Meta runs the Meta check.
 */
export function ConnectionsTab() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const oauthError = params.get('error');
  const list = useQuery({ queryKey: ['integrations'], queryFn: async () => unwrap(await api.GET('/integrations')).data });
  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string } | null>(null);
  const [eventsFor, setEventsFor] = useState<Integration | null>(null);
  const [sender, setSender] = useState<'whatsapp_cloud' | 'email_ses' | null>(null);
  const [portal, setPortal] = useState(false);
  const [webhook, setWebhook] = useState<{ open: boolean; existing: { integrationId: string; name: string; settings: Record<string, unknown> } | null }>({ open: false, existing: null });
  const [metaCheck, setMetaCheck] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations'] });

  const connect = useMutation({
    mutationFn: async () => unwrap(await api.POST('/integrations', { body: { provider: 'meta', scope: 'tenant' } as Schemas['IntegrationConnect'] })),
    onSuccess: (r) => {
      if (r.authorizeUrl) window.location.href = r.authorizeUrl;
      else void refresh();
    },
  });
  const test = useMutation({
    mutationFn: async (id: string) => unwrap(await api.POST('/integrations/{id}/test', { params: { path: { id } } })),
    onSuccess: (r) => setTestResult({ ok: !!r.ok, ...(r.detail ? { detail: r.detail } : {}) }),
  });
  const retry = useMutation({ mutationFn: async (id: string) => unwrap(await api.POST('/integrations/{id}/retry', { params: { path: { id } } })), onSuccess: refresh });
  const disconnect = useMutation({ mutationFn: async (id: string) => unwrap(await api.DELETE('/integrations/{id}', { params: { path: { id } } })), onSuccess: refresh });
  const error = connect.error ?? test.error ?? retry.error ?? disconnect.error;
  const failing = (list.data ?? []).filter((i) => i.status === 'error' && i.lastError);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setWebhook({ open: true, existing: null })}>
          New general webhook
        </Button>
        <Button size="sm" variant="outline" onClick={() => setPortal(true)}>
          Connect portal
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSender('whatsapp_cloud')}>
          Connect WhatsApp
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSender('email_ses')}>
          Connect email sender
        </Button>
        <Button size="sm" disabled={connect.isPending} onClick={() => connect.mutate()}>
          Connect Meta lead ads
        </Button>
      </div>
      {oauthError ? <Alert>Meta connection was not completed ({oauthError}).</Alert> : null}
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      {testResult ? <Alert tone={testResult.ok ? 'success' : 'danger'}>{testResult.ok ? 'Connection works.' : `Test failed: ${testResult.detail ?? ''}`}</Alert> : null}
      {list.isLoading ? <Loading /> : null}
      <Table>
        <thead>
          <tr>
            <Th>Connection</Th>
            <Th>Status</Th>
            <Th>Last sync</Th>
            <Th>Received (30 days)</Th>
            <Th>Failures</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((i) => (
            <Tr key={i.id}>
              <Td>
                <p className="font-medium">{LABEL[i.provider] ?? i.provider}</p>
                <p className="text-xs text-muted-foreground">{i.accountLabel}</p>
                {i.provider === 'webhook' || i.provider === 'website' ? (
                  <p className="max-w-72 truncate font-mono text-[11px] text-muted-foreground" title={String(i.settings?.inboundUrl ?? '')}>
                    {String(i.settings?.inboundUrl ?? '')}
                  </p>
                ) : null}
                {i.provider in PORTALS ? (
                  <p className="text-[11px] text-muted-foreground">
                    {[i.settings?.accountId ? `Account ${String(i.settings.accountId)}` : null, i.settings?.inboundEmail ? `Lead emails to ${String(i.settings.inboundEmail)}` : null].filter(Boolean).join(' · ') ||
                      'Webhook with the shared secret'}
                  </p>
                ) : null}
              </Td>
              <Td>
                <Badge tone={STATUS_TONE[i.status]}>{i.status === 'connected' ? 'Connected' : i.status[0]!.toUpperCase() + i.status.slice(1)}</Badge>
              </Td>
              <Td className="text-xs">{formatDateTime(i.lastSuccessAt)}</Td>
              <Td>{i.recordsReceived30d ?? 0}</Td>
              <Td className={i.failures30d ? 'font-medium text-danger' : undefined}>{i.failures30d ?? 0}</Td>
              <Td className="whitespace-nowrap">
                <Button variant="link" size="sm" onClick={() => test.mutate(i.id)}>
                  Test
                </Button>
                <span className="px-1 text-muted-foreground">·</span>
                <Button variant="link" size="sm" onClick={() => retry.mutate(i.id)}>
                  Retry
                </Button>
                <span className="px-1 text-muted-foreground">·</span>
                <Button variant="link" size="sm" onClick={() => setEventsFor(i)}>
                  Events
                </Button>
                {(i.provider === 'webhook' || i.provider === 'website') && i.status === 'connected' ? (
                  <>
                    <span className="px-1 text-muted-foreground">·</span>
                    <Button variant="link" size="sm" onClick={() => setWebhook({ open: true, existing: { integrationId: i.id, name: i.accountLabel, settings: i.settings ?? {} } })}>
                      Mapping
                    </Button>
                  </>
                ) : null}
                {i.provider === 'meta' && i.status === 'connected' ? (
                  <>
                    <span className="px-1 text-muted-foreground">·</span>
                    <Button variant="link" size="sm" onClick={() => setMetaCheck(i.id)}>
                      Meta check
                    </Button>
                  </>
                ) : null}
                <span className="px-1 text-muted-foreground">·</span>
                <Button variant="link" size="sm" className="text-danger" onClick={() => window.confirm('Disconnect this account?') && disconnect.mutate(i.id)}>
                  Disconnect
                </Button>
              </Td>
            </Tr>
          ))}
          {list.data?.length === 0 ? (
            <tr>
              <Td colSpan={6} className="text-center text-muted-foreground">
                No connections yet. Connect Meta, a portal or a general webhook to receive leads automatically.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
      {failing.map((i) => (
        <Alert key={i.id}>
          {LABEL[i.provider] ?? i.provider}: &quot;{i.lastError}&quot; since {formatDateTime(i.lastErrorAt)}. Waiting leads import automatically once fixed.
        </Alert>
      ))}
      <EventsDialog integration={eventsFor} onClose={() => setEventsFor(null)} />
      <ConnectSenderDialog provider={sender} onClose={() => setSender(null)} />
      <ConnectPortalDialog open={portal} onClose={() => setPortal(false)} />
      <GeneralWebhookDialog open={webhook.open} existing={webhook.existing} onClose={() => setWebhook({ open: false, existing: null })} />
      <MetaCheckDialog integrationId={metaCheck} onClose={() => setMetaCheck(null)} />
    </div>
  );
}

/** Incoming webhook events: failed ones are retried automatically, then shown for manual retry (SRS §11.4). */
function EventsDialog({ integration, onClose }: { integration: Integration | null; onClose: () => void }) {
  const qc = useQueryClient();
  const events = useQuery({
    queryKey: ['integration-events', integration?.id],
    enabled: !!integration,
    queryFn: async () => unwrap(await api.GET('/integrations/{id}/events', { params: { path: { id: integration!.id }, query: { limit: 50 } } })).data,
  });
  const retry = useMutation({
    mutationFn: async (id: string) => unwrap(await api.POST('/webhook-events/{id}/retry', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integration-events'] }),
  });
  return (
    <Dialog open={!!integration} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Incoming events" wide>
        {events.isLoading ? <Loading /> : null}
        {retry.error ? <Alert>{errorMessage(retry.error)}</Alert> : null}
        <Table>
          <thead>
            <tr>
              <Th>Received</Th>
              <Th>Status</Th>
              <Th>Attempts</Th>
              <Th>Error</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {(events.data ?? []).map((e) => (
              <Tr key={e.id}>
                <Td className="text-xs">{formatDateTime(e.receivedAt)}</Td>
                <Td>
                  <Badge tone={e.status === 'processed' ? 'success' : e.status === 'failed' ? 'danger' : 'neutral'}>{e.status}</Badge>
                </Td>
                <Td>{e.attempts}</Td>
                <Td className="max-w-64 text-xs">{e.lastError ?? '—'}</Td>
                <Td>
                  {e.status === 'failed' ? (
                    <Button variant="link" size="sm" onClick={() => retry.mutate(e.id)}>
                      Retry
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
            {events.data?.length === 0 ? (
              <tr>
                <Td colSpan={5} className="text-center text-muted-foreground">
                  No events received yet.
                </Td>
              </tr>
            ) : null}
          </tbody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
