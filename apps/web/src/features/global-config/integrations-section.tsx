'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Loading, Table, Td, Th, Tr, cn } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, Plug } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { formatDateTime } from '@/core/format';
import { INTEGRATION_TABS, INTEGRATIONS, type IntegrationCard } from './catalog';
import { ConnectGoogleAdsDialog } from './connect-google-ads-dialog';
import { ConnectPortalDialog, type Portal } from './connect-portal-dialog';
import { ConnectSenderDialog } from './connect-sender-dialog';
import { GeneralWebhookDialog } from './general-webhook-dialog';
import { MetaCheckDialog } from './meta-check-dialog';

type Integration = Schemas['Integration'];

const STATUS_TONE = { connected: 'success', pending: 'warning', error: 'danger', disconnected: 'neutral' } as const;
const STATUS_LABEL = { connected: 'Connected', pending: 'Pending', error: 'Error', disconnected: 'Disconnected' } as const;

export function useIntegrations() {
  return useQuery({ queryKey: ['integrations'], queryFn: async () => unwrap(await api.GET('/integrations')).data });
}

/**
 * Integration cards (Global Configuration §7): 3rd Parties, Social Platforms and Others. A card is Connected only
 * when the integration reports it; it offers Manage, Test Connection and Disconnect. Cards without a connector yet
 * say so instead of offering Connect Now.
 */
export function IntegrationsSection() {
  const params = useSearchParams();
  const oauthError = params.get('error');
  const connected = params.get('connected');
  const [tab, setTab] = useState<(typeof INTEGRATION_TABS)[number]['key']>('third_party');
  const list = useIntegrations();

  return (
    <div className="space-y-4">
      {oauthError ? <Alert>The connection was not completed ({oauthError}).</Alert> : null}
      {connected ? <Alert tone="success">Connected. New leads will arrive automatically.</Alert> : null}
      <div role="tablist" className="inline-flex rounded-lg border border-border bg-muted/50 p-1">
        {INTEGRATION_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', tab === t.key ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {list.isLoading ? <Loading /> : null}
      {list.error ? <Alert>{errorMessage(list.error)}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {INTEGRATIONS.filter((c) => c.tab === tab).map((card) => (
          <IntegrationTile key={card.key} card={card} rows={(list.data ?? []).filter((i) => card.providers.includes(i.provider))} />
        ))}
      </div>
    </div>
  );
}

export function IntegrationTile({ card, rows }: { card: IntegrationCard; rows: Integration[] }) {
  const qc = useQueryClient();
  const [connectOpen, setConnectOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string } | null>(null);
  const active = rows.filter((r) => r.status !== 'disconnected');
  const isConnected = active.some((r) => r.status === 'connected');
  const failing = active.find((r) => r.status === 'error');
  const lastSync = active.map((r) => r.lastSuccessAt).filter(Boolean).sort().at(-1);

  const meta = useMutation({
    mutationFn: async () => unwrap(await api.POST('/integrations', { body: { provider: 'meta', scope: 'tenant' } as Schemas['IntegrationConnect'] })),
    onSuccess: (r) => {
      if (r.authorizeUrl) window.location.href = r.authorizeUrl;
      else void qc.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
  const test = useMutation({
    mutationFn: async (id: string) => unwrap(await api.POST('/integrations/{id}/test', { params: { path: { id } } })),
    onSuccess: (r) => setTestResult({ ok: !!r.ok, ...(r.detail ? { detail: r.detail } : {}) }),
  });

  const connect = () => {
    setTestResult(null);
    if (card.connect === 'meta') meta.mutate();
    else setConnectOpen(true);
  };

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-bold', card.tone)}>{card.mark}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{card.name}</p>
          <p className="text-sm text-muted-foreground">{card.description}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {!card.connect ? (
          <Badge tone="neutral">Not available yet</Badge>
        ) : isConnected ? (
          <Badge tone="success">
            <CheckCircle2 className="mr-1 size-3" />
            Connected{active.length > 1 ? ` (${active.length})` : ''}
          </Badge>
        ) : active.length ? (
          <Badge tone={STATUS_TONE[active[0]!.status]}>{STATUS_LABEL[active[0]!.status]}</Badge>
        ) : (
          <Badge tone="neutral">Not connected</Badge>
        )}
        {lastSync ? <span className="text-muted-foreground">Last sync {formatDateTime(lastSync)}</span> : null}
      </div>
      {failing?.lastError ? (
        <p className="mt-2 flex items-start gap-1 text-xs text-danger">
          <CircleAlert className="mt-px size-3.5 shrink-0" /> {failing.lastError}
        </p>
      ) : null}
      {testResult ? (
        <p className={cn('mt-2 text-xs', testResult.ok ? 'text-emerald-700' : 'text-danger')}>{testResult.ok ? 'Connection works.' : `Test failed: ${testResult.detail ?? ''}`}</p>
      ) : null}
      {meta.error || test.error ? <p className="mt-2 text-xs text-danger">{errorMessage(meta.error ?? test.error)}</p> : null}
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {card.connect && active.length ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setManage(true)}>
              Manage
            </Button>
            <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate(active[0]!.id)}>
              Test Connection
            </Button>
            {card.connect === 'webhook' || card.connect === 'website' || card.connect === 'portal' ? (
              <Button size="sm" variant="link" onClick={connect}>
                Add another
              </Button>
            ) : null}
          </>
        ) : card.connect ? (
          <Button size="sm" disabled={meta.isPending} onClick={connect}>
            <Plug className="size-4" /> Connect Now
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled>
            Connect Now
          </Button>
        )}
      </div>

      {card.connect === 'webhook' || card.connect === 'website' ? (
        <GeneralWebhookDialog open={connectOpen} existing={null} onClose={() => setConnectOpen(false)} />
      ) : null}
      {card.connect === 'portal' ? <ConnectPortalDialog open={connectOpen} initial={card.key as Portal} onClose={() => setConnectOpen(false)} /> : null}
      {card.connect === 'google_ads' ? <ConnectGoogleAdsDialog open={connectOpen} onClose={() => setConnectOpen(false)} /> : null}
      {card.connect === 'whatsapp' || card.connect === 'email' ? (
        <ConnectSenderDialog provider={connectOpen ? (card.connect === 'whatsapp' ? 'whatsapp_cloud' : 'email_ses') : null} onClose={() => setConnectOpen(false)} />
      ) : null}
      <ManageDialog open={manage} title={card.name} rows={active} onClose={() => setManage(false)} />
    </div>
  );
}

/** The connected accounts of one card: status, last sync, records, failures; Test, Retry, Events, Mapping, Disconnect. */
function ManageDialog({ open, title, rows, onClose }: { open: boolean; title: string; rows: Integration[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string } | null>(null);
  const [eventsFor, setEventsFor] = useState<Integration | null>(null);
  const [webhook, setWebhook] = useState<{ integrationId: string; name: string; settings: Record<string, unknown> } | null>(null);
  const [metaCheck, setMetaCheck] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations'] });
  const test = useMutation({
    mutationFn: async (id: string) => unwrap(await api.POST('/integrations/{id}/test', { params: { path: { id } } })),
    onSuccess: (r) => setTestResult({ ok: !!r.ok, ...(r.detail ? { detail: r.detail } : {}) }),
  });
  const retry = useMutation({ mutationFn: async (id: string) => unwrap(await api.POST('/integrations/{id}/retry', { params: { path: { id } } })), onSuccess: refresh });
  const disconnect = useMutation({ mutationFn: async (id: string) => unwrap(await api.DELETE('/integrations/{id}', { params: { path: { id } } })), onSuccess: refresh });
  const error = test.error ?? retry.error ?? disconnect.error;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${title}: connections`} wide>
        <div className="space-y-3">
          {error ? <Alert>{errorMessage(error)}</Alert> : null}
          {testResult ? <Alert tone={testResult.ok ? 'success' : 'danger'}>{testResult.ok ? 'Connection works.' : `Test failed: ${testResult.detail ?? ''}`}</Alert> : null}
          <Table>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th>Status</Th>
                <Th>Last sync</Th>
                <Th>Received (30 days)</Th>
                <Th>Failures</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <Tr key={i.id}>
                  <Td>
                    <p className="font-medium">{i.accountLabel}</p>
                    {i.settings?.inboundUrl ? (
                      <p className="max-w-72 truncate font-mono text-[11px] text-muted-foreground" title={String(i.settings.inboundUrl)}>
                        {String(i.settings.inboundUrl)}
                      </p>
                    ) : null}
                    {i.lastError ? <p className="text-xs text-danger">{i.lastError}</p> : null}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge>
                  </Td>
                  <Td className="text-xs">{formatDateTime(i.lastSuccessAt)}</Td>
                  <Td>{i.recordsReceived30d ?? 0}</Td>
                  <Td className={i.failures30d ? 'font-medium text-danger' : undefined}>{i.failures30d ?? 0}</Td>
                  <Td className="whitespace-nowrap">
                    <Button variant="link" size="sm" onClick={() => test.mutate(i.id)}>
                      Test
                    </Button>
                    <Button variant="link" size="sm" onClick={() => retry.mutate(i.id)}>
                      Retry
                    </Button>
                    <Button variant="link" size="sm" onClick={() => setEventsFor(i)}>
                      Events
                    </Button>
                    {(i.provider === 'webhook' || i.provider === 'website') && i.status === 'connected' ? (
                      <Button variant="link" size="sm" onClick={() => setWebhook({ integrationId: i.id, name: i.accountLabel, settings: i.settings ?? {} })}>
                        Mapping
                      </Button>
                    ) : null}
                    {i.provider === 'meta' && i.status === 'connected' ? (
                      <Button variant="link" size="sm" onClick={() => setMetaCheck(i.id)}>
                        Meta check
                      </Button>
                    ) : null}
                    <Button variant="link" size="sm" className="text-danger" onClick={() => window.confirm('Disconnect this account?') && disconnect.mutate(i.id)}>
                      Disconnect
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
        <EventsDialog integration={eventsFor} onClose={() => setEventsFor(null)} />
        <GeneralWebhookDialog open={!!webhook} existing={webhook} onClose={() => setWebhook(null)} />
        <MetaCheckDialog integrationId={metaCheck} onClose={() => setMetaCheck(null)} />
      </DialogContent>
    </Dialog>
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
