'use client';

import { Alert, Button, Dialog, DialogContent, Field, Input } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError, errorMessage, unwrap } from '@/core/api';

/**
 * Connect the company's WhatsApp Business number (Meta Cloud API, SRS §5.7–5.8) or its email sender.
 * The access token goes to the secret store on the server and is never shown again.
 */
export function ConnectSenderDialog({ provider, onClose }: { provider: 'whatsapp_cloud' | 'email_ses' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const connect = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/integrations', {
          body: { provider: provider!, scope: 'tenant', settings: Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim())) } as Schemas['IntegrationConnect'],
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['integrations'] });
      close();
    },
  });
  const err = (field: string) => (connect.error instanceof ApiError ? connect.error.fieldError(`settings.${field}`) : undefined);
  const notVerified = connect.error instanceof ApiError && connect.error.problem.code === 'LICENCE_NOT_VERIFIED';

  function close() {
    setF({});
    connect.reset();
    onClose();
  }

  return (
    <Dialog open={!!provider} onOpenChange={(o) => !o && close()}>
      <DialogContent title={provider === 'whatsapp_cloud' ? 'Connect WhatsApp Business' : 'Connect email sender'}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            connect.mutate();
          }}
        >
          {provider === 'whatsapp_cloud' ? (
            <>
              <p className="text-sm text-muted-foreground">From your WhatsApp Business account in Meta Business Manager. Your company pays Meta directly for messages.</p>
              <Field label="Phone number ID *" error={err('phoneNumberId')}>
                <Input value={f.phoneNumberId ?? ''} onChange={set('phoneNumberId')} />
              </Field>
              <Field label="WhatsApp Business account ID *" error={err('wabaId')}>
                <Input value={f.wabaId ?? ''} onChange={set('wabaId')} />
              </Field>
              <Field label="Number shown to agents">
                <Input value={f.displayPhone ?? ''} onChange={set('displayPhone')} placeholder="+971 4 555 0100" />
              </Field>
              <Field label="Permanent access token" error={err('accessToken')}>
                <Input type="password" autoComplete="off" value={f.accessToken ?? ''} onChange={set('accessToken')} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Send from (email) *" error={err('fromAddress')}>
                <Input type="email" value={f.fromAddress ?? ''} onChange={set('fromAddress')} placeholder="sales@yourcompany.ae" />
              </Field>
              <Field label="Sender name">
                <Input value={f.fromName ?? ''} onChange={set('fromName')} placeholder="Al Noor Realty" />
              </Field>
            </>
          )}
          {notVerified ? (
            <Alert tone="warning">WhatsApp can be connected once our team has verified your company licence (Organization → Profile shows the status).</Alert>
          ) : connect.error ? (
            <Alert>{errorMessage(connect.error)}</Alert>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={connect.isPending}>
              Connect
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
