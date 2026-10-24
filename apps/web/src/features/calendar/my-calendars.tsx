'use client';

import { Alert, Badge, Button, Dialog, DialogContent } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';

type CalendarProvider = Schemas['CalendarConnect']['provider'];

const PROVIDERS: { key: CalendarProvider; name: string; links: string }[] = [
  { key: 'google_workspace', name: 'Google Calendar', links: 'Google Meet links' },
  { key: 'microsoft_365', name: 'Microsoft 365', links: 'Teams links' },
];
const STATUS = { connected: ['success', 'Connected'], pending: ['warning', 'Waiting for sign-in'], error: ['danger', 'Connect again'], disconnected: ['neutral', 'Not connected'] } as const;

/**
 * The agent's own calendars (SRS §3.8, §3.13): connecting one signs in with Google or Microsoft, after which
 * meetings get Meet / Teams links and changes made in that calendar come back to the CRM. The sign-in returns to
 * Tasks & Calendar with ?calendarConnected= or ?calendarError=, which opens this dialog with the result.
 */
export function MyCalendarsButton() {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const calendars = useQuery({ queryKey: ['my-calendars'], queryFn: async () => unwrap(await api.GET('/me/calendars')).data, enabled: open });
  const connect = useMutation({
    mutationFn: async (provider: CalendarProvider) => unwrap(await api.POST('/me/calendars', { body: { provider } })),
    onSuccess: (r) => {
      if (r.authorizeUrl) window.location.href = r.authorizeUrl;
    },
  });
  const disconnect = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE('/me/calendars/{id}', { params: { path: { id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['my-calendars'] }),
  });

  useEffect(() => {
    const connected = params.get('calendarConnected');
    const failed = params.get('calendarError');
    if (!connected && !failed) return;
    const name = PROVIDERS.find((p) => p.key === connected)?.name ?? 'Your calendar';
    setResult(connected ? { ok: true, text: `${name} is connected.` } : { ok: false, text: failed === 'invalid_state' ? 'The sign-in link expired. Please try again.' : 'The calendar could not be connected. Please try again.' });
    setOpen(true);
    router.replace('/tasks');
  }, [params, router]);

  const byProvider = (key: CalendarProvider) => calendars.data?.find((c) => c.provider === key);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CalendarCheck /> My calendars
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && (setOpen(false), setResult(null))}>
        <DialogContent title="My calendars">
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">Connect your own calendar so meetings get online meeting links and changes you make there come back to the CRM.</p>
            {result ? <Alert tone={result.ok ? 'success' : 'danger'}>{result.text}</Alert> : null}
            {connect.error || disconnect.error ? <Alert>{errorMessage(connect.error ?? disconnect.error)}</Alert> : null}
            {PROVIDERS.map((p) => {
              const c = byProvider(p.key);
              const [tone, label] = STATUS[c?.status ?? 'disconnected'];
              return (
                <div key={p.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{c?.status === 'connected' ? c.accountLabel : p.links}</p>
                    {c?.status === 'error' && c.lastError ? <p className="text-xs text-danger">{c.lastError}</p> : null}
                  </div>
                  <Badge tone={tone}>{label}</Badge>
                  {c?.status === 'connected' ? (
                    <Button size="sm" variant="outline" disabled={disconnect.isPending} onClick={() => disconnect.mutate(c.id)}>
                      Disconnect
                    </Button>
                  ) : (
                    <Button size="sm" disabled={connect.isPending} onClick={() => connect.mutate(p.key)}>
                      {c ? 'Connect again' : 'Connect'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
