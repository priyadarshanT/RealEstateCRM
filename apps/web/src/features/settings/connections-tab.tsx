'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Loading, Table, Td, Th, Tr } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { formatDateTime } from '@/core/format';
import { ConnectSenderDialog } from './connect-sender-dialog';

type Integration = Schemas['Integration'];

const LABEL: Partial<Record<Integration['provider'], string>> = { meta: 'Meta lead ads', whatsapp_cloud: 'WhatsApp (Meta, direct)', email_ses: 'Email sender' };

const STATUS_TONE = { connected: 'success', pending: 'warning', error: 'danger', disconnected: 'neutral' } as const;

/**
 * Connections (SRS §11.3, wireframe "Settings and integrations"): Meta lead ads, the WhatsApp Business number
 * and the email sender. Each row: status, last sync, records, failures, Test / Retry / Disconnect.
 */
export function ConnectionsTab() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const oauthError = params.get('error');
  const list = useQuery({ queryKey: ['integrations'], queryFn: async () => unwrap(await api.GET('/integrations')).data });
  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string } | null>(null);
  const [eventsFor, setEventsFor] = useState<Integration | null>(null);
  const [sender, setSender] = useState<'whatsapp_cloud' | 'email_ses' | null>(null);
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
                No connections yet. Connect Meta to receive lead-ad leads automatically.
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
