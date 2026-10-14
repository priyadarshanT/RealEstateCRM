'use client';

import { Alert, Button, Dialog, DialogContent, Field, Input, Select } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError, errorMessage, unwrap } from '@/core/api';
import { useSources } from '@/core/lookups';

export const PORTALS = { property_finder: 'Property Finder', bayut: 'Bayut', dubizzle: 'Dubizzle' } as const;
type Portal = keyof typeof PORTALS;

/**
 * Property Finder, Bayut or Dubizzle (SRS §11.1): leads arrive by webhook with the shared secret agreed with the
 * portal, or by lead email to the inbound address. The secret goes to the secret store and is never shown again.
 */
export function ConnectPortalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const sources = useSources();
  const [provider, setProvider] = useState<Portal>('property_finder');
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const connect = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/integrations', {
          body: { provider, scope: 'tenant', settings: Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])) } as Schemas['IntegrationConnect'],
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['integrations'] });
      close();
    },
  });
  const err = (field: string) => (connect.error instanceof ApiError ? connect.error.fieldError(`settings.${field}`) : undefined);
  const portalSources = sources.data?.filter((s) => s.type === provider) ?? [];

  function close() {
    setF({});
    connect.reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title="Connect a property portal">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            connect.mutate();
          }}
        >
          <Field label="Portal">
            <Select value={provider} onChange={(e) => setProvider(e.target.value as Portal)}>
              {(Object.keys(PORTALS) as Portal[]).map((p) => (
                <option key={p} value={p}>
                  {PORTALS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Agency / account ID at the portal">
            <Input value={f.accountId ?? ''} onChange={set('accountId')} />
          </Field>
          <Field label="Shared secret * (at least 16 characters, also given to the portal)" error={err('sharedSecret')}>
            <Input type="password" autoComplete="off" value={f.sharedSecret ?? ''} onChange={set('sharedSecret')} />
          </Field>
          <Field label="Lead email address (if the portal emails leads)" error={err('inboundEmail')}>
            <Input type="email" value={f.inboundEmail ?? ''} onChange={set('inboundEmail')} placeholder="leads@yourcompany.ae" />
          </Field>
          <Field label="Lead source" error={err('sourceId')}>
            <Select value={f.sourceId ?? ''} onChange={set('sourceId')}>
              <option value="">{PORTALS[provider]} (created automatically)</option>
              {portalSources.map((s) => (
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
            <Button type="submit" disabled={connect.isPending}>
              Connect
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
