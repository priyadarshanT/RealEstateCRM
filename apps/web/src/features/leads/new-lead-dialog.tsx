'use client';

import { Alert, Button, Dialog, DialogContent, Field, Input, Select, Textarea } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { byId, useCampaigns, useColleagues, useSources } from '@/core/lookups';
import { useCan } from '@/core/session';
import { checkExisting, useCreateLead } from './leads-api';

type Existing = Awaited<ReturnType<typeof checkExisting>>;

/** Manual lead entry (SRS §2.1). Typing a phone or email that already exists shows who owns it (§2.9). */
export function NewLeadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const can = useCan();
  const sources = useSources();
  const campaigns = useCampaigns();
  const colleagues = useColleagues();
  const userById = byId(colleagues.data);
  const create = useCreateLead();
  const manual = sources.data?.find((s) => s.type === 'manual');

  const [form, setForm] = useState<Partial<Schemas['LeadCreate']>>({ priority: 'medium', budgetCurrency: 'AED' });
  const [existing, setExisting] = useState<Existing | null>(null);
  const set = (patch: Partial<Schemas['LeadCreate']>) => setForm((f) => ({ ...f, ...patch }));

  async function checkDuplicate() {
    if (!form.phonePrimary && !form.email) return setExisting(null);
    try {
      setExisting(await checkExisting(form.phonePrimary || undefined, form.email || undefined));
    } catch {
      setExisting(null);
    }
  }

  function close() {
    onOpenChange(false);
    setForm({ priority: 'medium', budgetCurrency: 'AED' });
    setExisting(null);
    create.reset();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const sourceId = form.sourceId ?? manual?.id;
    if (!form.fullName || !sourceId) return;
    const body = Object.fromEntries(Object.entries({ ...form, sourceId }).filter(([, v]) => v !== '' && v !== undefined)) as Schemas['LeadCreate'];
    const lead = await create.mutateAsync(body).catch(() => null);
    if (lead) {
      close();
      router.push(`/leads/${lead.id}`);
    }
  }

  // Shown after the phone/email check, or when saving returns 409 LEAD_EXISTS (the problem carries the existing lead).
  const conflict = create.error instanceof ApiError && create.error.problem.code === 'LEAD_EXISTS' ? (create.error.problem as { lead?: Schemas['LeadExists'] }).lead : undefined;
  const existingLead = conflict ?? (existing?.exists ? existing.lead : null) ?? null;
  const ownerName = existingLead?.ownerName ?? (existingLead?.ownerUserId ? userById.get(existingLead.ownerUserId)?.fullName : null) ?? 'nobody (Unassigned)';
  const fieldErr = (f: string) => (create.error instanceof ApiError ? create.error.fieldError(f) : undefined);

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent title="New lead" wide>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name *" error={fieldErr('fullName')}>
            <Input value={form.fullName ?? ''} onChange={(e) => set({ fullName: e.target.value })} required />
          </Field>
          <Field label="Source">
            <Select value={form.sourceId ?? manual?.id ?? ''} onChange={(e) => set({ sourceId: e.target.value })}>
              {sources.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Phone" error={fieldErr('phonePrimary')}>
            <Input value={form.phonePrimary ?? ''} onChange={(e) => set({ phonePrimary: e.target.value })} onBlur={checkDuplicate} placeholder="+971 50 123 4567" />
          </Field>
          <Field label="Email" error={fieldErr('email')}>
            <Input type="email" value={form.email ?? ''} onChange={(e) => set({ email: e.target.value })} onBlur={checkDuplicate} />
          </Field>

          {existingLead ? (
            <Alert className="sm:col-span-2">
              This lead already exists, owned by <b>{ownerName}</b>
              {existingLead.stageName ? ` (stage: ${existingLead.stageName})` : ''}.{' '}
              <Button
                type="button"
                size="sm"
                className="ml-2"
                onClick={() => {
                  close();
                  router.push(`/leads/${existingLead.leadId}`);
                }}
              >
                Open existing lead
              </Button>
            </Alert>
          ) : null}

          <Field label="Alternate phone">
            <Input value={form.phoneAlternate ?? ''} onChange={(e) => set({ phoneAlternate: e.target.value })} />
          </Field>
          <Field label="Country (2-letter code)">
            <Input value={form.countryCode ?? ''} maxLength={2} onChange={(e) => set({ countryCode: e.target.value.toUpperCase() })} placeholder="AE" />
          </Field>
          <Field label="Budget min (AED)">
            <Input inputMode="decimal" value={form.budgetMin ?? ''} onChange={(e) => set({ budgetMin: e.target.value })} />
          </Field>
          <Field label="Budget max (AED)">
            <Input inputMode="decimal" value={form.budgetMax ?? ''} onChange={(e) => set({ budgetMax: e.target.value })} />
          </Field>
          <Field label="Campaign">
            <Select value={form.campaignId ?? ''} onChange={(e) => set({ campaignId: e.target.value || undefined })}>
              <option value="">—</option>
              {campaigns.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => set({ priority: e.target.value as 'low' | 'medium' | 'high' })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </Field>
          {can('leads.assign') ? (
            <Field label="Agent (empty = assignment rules)">
              <Select value={form.ownerUserId ?? ''} onChange={(e) => set({ ownerUserId: e.target.value || undefined })}>
                <option value="">Assign automatically</option>
                {colleagues.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Note" className="sm:col-span-2">
            <Textarea value={form.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
          </Field>

          {create.error && !conflict ? <Alert className="sm:col-span-2">{errorMessage(create.error)}</Alert> : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !form.fullName}>
              {create.isPending ? 'Saving…' : 'Create lead'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
