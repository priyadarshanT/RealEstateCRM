'use client';

import { Alert, Badge, Button, Card, CardBody, Field, Input, Loading } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage, unwrap } from '@/core/api';
import { useCan } from '@/core/session';

type Tenant = Schemas['Tenant'];

/** Company profile: name, licence and RERA numbers, contact details, time zone and base currency. */
export function ProfileTab() {
  const qc = useQueryClient();
  const can = useCan();
  const org = useQuery({ queryKey: ['organization'], queryFn: async () => unwrap(await api.GET('/organization')) });
  const [form, setForm] = useState<Partial<Tenant>>({});
  const save = useMutation({
    mutationFn: async () => unwrap(await api.PATCH('/organization', { body: form as Tenant })),
    onSuccess: () => {
      setForm({});
      void qc.invalidateQueries({ queryKey: ['organization'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  if (org.isLoading) return <Loading />;
  if (org.error || !org.data) return <Alert>{errorMessage(org.error)}</Alert>;
  const t = org.data;
  const editable = can('settings.manage');
  const v = (k: keyof Tenant) => String((k in form ? form[k] : t[k]) ?? '');
  const set = (k: keyof Tenant) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const err = (f: string) => (save.error instanceof ApiError ? save.error.fieldError(f) : undefined);
  const verification = { pending: ['warning', 'Licence check pending'], verified: ['success', 'Licence verified'], rejected: ['danger', 'Licence rejected'] } as const;
  const [tone, label] = verification[t.verificationStatus];

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 sm:col-span-2">
            <Badge tone="primary">{t.type === 'brokerage' ? 'Brokerage' : 'Individual agent'}</Badge>
            <Badge tone={tone}>{label}</Badge>
            {t.verificationStatus === 'pending' ? <span className="text-xs text-muted-foreground">Our team checks the licence. WhatsApp can be connected after this check.</span> : null}
          </div>
          <Field label="Company name" error={err('name')}>
            <Input value={v('name')} onChange={set('name')} disabled={!editable} required />
          </Field>
          <Field label="Legal name">
            <Input value={v('legalName')} onChange={set('legalName')} disabled={!editable} />
          </Field>
          {t.type === 'brokerage' ? (
            <>
              <Field label="Trade licence no.">
                <Input value={v('tradeLicenseNo')} onChange={set('tradeLicenseNo')} disabled={!editable} />
              </Field>
              <Field label="RERA ORN">
                <Input value={v('reraOrn')} onChange={set('reraOrn')} disabled={!editable} />
              </Field>
            </>
          ) : (
            <Field label="RERA broker card (BRN)">
              <Input value={v('reraBrn')} onChange={set('reraBrn')} disabled={!editable} />
            </Field>
          )}
          <Field label="TRN (VAT number)" error={err('trn')}>
            <Input value={v('trn')} onChange={set('trn')} disabled={!editable} />
          </Field>
          <Field label="Email" error={err('email')}>
            <Input type="email" value={v('email')} onChange={set('email')} disabled={!editable} />
          </Field>
          <Field label="Phone">
            <Input value={v('phone')} onChange={set('phone')} disabled={!editable} />
          </Field>
          <Field label="Website">
            <Input value={v('website')} onChange={set('website')} disabled={!editable} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input value={v('address')} onChange={set('address')} disabled={!editable} />
          </Field>
          <Field label="Time zone">
            <Input value={v('timezone')} onChange={set('timezone')} disabled={!editable} />
          </Field>
          <Field label="Base currency">
            <Input value={v('baseCurrency')} disabled />
          </Field>
          {save.error ? <Alert className="sm:col-span-2">{errorMessage(save.error)}</Alert> : null}
          {save.isSuccess ? (
            <Alert tone="success" className="sm:col-span-2">
              Saved.
            </Alert>
          ) : null}
          {editable ? (
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" disabled={!Object.keys(form).length || save.isPending}>
                Save profile
              </Button>
            </div>
          ) : null}
        </form>
      </CardBody>
    </Card>
  );
}
