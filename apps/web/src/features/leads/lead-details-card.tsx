'use client';

import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, DialogContent, Field, Input, Select } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { Pencil } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { formatMoney, initials } from '@/core/format';
import { byId, useCampaigns, useSources, useUsers } from '@/core/lookups';
import { useInquiries, useLeadMutations, useShares, type Lead } from './leads-api';
import { PriorityBadge } from './stage-badge';

/** Contact details, owner, priority and sharing (left column of the lead page wireframe). */
export function LeadDetailsCard({ lead, canEdit }: { lead: Lead; canEdit: boolean }) {
  const sources = byId(useSources().data);
  const campaigns = byId(useCampaigns().data);
  const users = byId(useUsers().data);
  const shares = useShares(lead.id);
  const { setPriority } = useLeadMutations(lead.id);
  const [editing, setEditing] = useState(false);

  const budget =
    lead.budgetMin || lead.budgetMax
      ? `${formatMoney(lead.budgetMin, lead.budgetCurrency ?? 'AED')} – ${lead.budgetMax ? Number(lead.budgetMax).toLocaleString('en-US') : '…'}`
      : '—';
  const rows: [string, React.ReactNode][] = [
    ['Phone', lead.phonePrimary ?? '—'],
    ['Alt. phone', lead.phoneAlternate ?? '—'],
    ['Email', lead.email ?? '—'],
    ['Budget', budget],
    ['Source', `${sources.get(lead.sourceId)?.name ?? '—'}${lead.campaignId ? ` · ${campaigns.get(lead.campaignId)?.name ?? ''}` : ''}`],
    ['Owner', lead.ownerUserId ? (users.get(lead.ownerUserId)?.fullName ?? 'Assigned') : 'Unassigned'],
  ];

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{initials(lead.fullName)}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{lead.fullName}</p>
            <p className="text-xs text-muted-foreground">{[lead.countryCode, lead.preferredLanguage].filter(Boolean).join(' · ') || '—'}</p>
          </div>
          {canEdit ? (
            <Button variant="ghost" size="icon" aria-label="Edit lead" onClick={() => setEditing(true)}>
              <Pencil />
            </Button>
          ) : null}
        </div>
        <dl className="grid grid-cols-[6.5rem_1fr] gap-y-1.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
          <dt className="text-muted-foreground">Priority</dt>
          <dd>
            {canEdit ? (
              <Select
                className="h-7 w-28 text-xs"
                value={lead.priority ?? 'medium'}
                onChange={(e) => setPriority.mutate(e.target.value as 'low' | 'medium' | 'high')}
                aria-label="Priority"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            ) : (
              <PriorityBadge priority={lead.priority} />
            )}
          </dd>
          <dt className="text-muted-foreground">Shared with</dt>
          <dd className="flex flex-wrap gap-1">
            {(shares.data ?? []).length === 0 ? '—' : null}
            {shares.data?.map((s) => (
              <span key={s.userId} className="text-xs">
                {s.userName ?? 'User'} <Badge tone="info">{s.access === 'edit' ? 'Can edit' : 'View'}</Badge>
              </span>
            ))}
          </dd>
        </dl>
        {setPriority.error ? <Alert>{errorMessage(setPriority.error)}</Alert> : null}
      </CardBody>
      <EditLeadDialog lead={lead} open={editing} onClose={() => setEditing(false)} />
    </Card>
  );
}

export function ScoreCard({ score }: { score: number }) {
  return (
    <Card>
      <CardHeader title="Lead score" />
      <CardBody>
        <div className="h-2 rounded-full bg-muted">
          <div className="h-2 rounded-full bg-gradient-to-r from-amber-400 to-primary" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
        </div>
        <p className="mt-2 text-xl font-semibold text-primary">
          {score} <span className="text-sm text-muted-foreground">/ 100</span>
        </p>
        <p className="text-xs text-muted-foreground">Budget fit · project match · source quality · engagement</p>
      </CardBody>
    </Card>
  );
}

/** Original enquiries with campaign, ad set, ad, form and submission IDs (SRS §2.2). */
export function EnquiriesCard({ leadId }: { leadId: string }) {
  const inquiries = useInquiries(leadId);
  const sources = byId(useSources().data);
  return (
    <Card>
      <CardHeader title={`Enquiries (${inquiries.data?.length ?? 0})`} />
      <CardBody className="space-y-2">
        {inquiries.data?.map((i) => (
          <div key={i.id} className="rounded border border-border p-2 text-xs">
            <p className="font-medium">
              {sources.get(i.sourceId)?.name ?? 'Source'} {i.isReEnquiry ? <Badge tone="warning">Re-enquiry</Badge> : null}
            </p>
            {i.formName ? <p>Form: {i.formName}</p> : null}
            {i.externalCampaignId ? <p className="text-muted-foreground">Campaign {i.externalCampaignId}</p> : null}
            {i.externalAdsetId ? <p className="text-muted-foreground">Ad set {i.externalAdsetId}</p> : null}
            {i.externalAdId ? <p className="text-muted-foreground">Ad {i.externalAdId}</p> : null}
            <p className="text-muted-foreground">Submitted {new Date(i.submittedAt).toLocaleString('en-GB')}</p>
            {Object.keys(i.formAnswers ?? {}).length ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-primary">Form answers</summary>
                <dl className="mt-1 grid grid-cols-2 gap-x-2">
                  {Object.entries(i.formAnswers).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function EditLeadDialog({ lead, open, onClose }: { lead: Lead; open: boolean; onClose: () => void }) {
  const { update } = useLeadMutations(lead.id);
  const campaigns = useCampaigns();
  const [form, setForm] = useState<Partial<Schemas['LeadUpdate']>>({});
  const value = <K extends keyof Schemas['LeadUpdate']>(k: K) => (k in form ? form[k] : (lead as Partial<Schemas['LeadUpdate']>)[k]) ?? '';
  const set = (patch: Partial<Schemas['LeadUpdate']>) => setForm((f) => ({ ...f, ...patch }));
  const conflict = update.error instanceof ApiError && update.error.status === 409;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await update.mutateAsync({ ...form, version: lead.version }).catch(() => null);
    if (ok) {
      setForm({});
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? null : (setForm({}), update.reset(), onClose()))}>
      <DialogContent title="Edit lead" wide>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <Input value={String(value('fullName'))} onChange={(e) => set({ fullName: e.target.value })} required />
          </Field>
          <Field label="Email">
            <Input type="email" value={String(value('email'))} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={String(value('phonePrimary'))} onChange={(e) => set({ phonePrimary: e.target.value })} />
          </Field>
          <Field label="Alternate phone">
            <Input value={String(value('phoneAlternate'))} onChange={(e) => set({ phoneAlternate: e.target.value })} />
          </Field>
          <Field label="Country (2-letter code)">
            <Input maxLength={2} value={String(value('countryCode'))} onChange={(e) => set({ countryCode: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Preferred language">
            <Input value={String(value('preferredLanguage'))} onChange={(e) => set({ preferredLanguage: e.target.value })} placeholder="English, Arabic" />
          </Field>
          <Field label="Budget min">
            <Input inputMode="decimal" value={String(value('budgetMin'))} onChange={(e) => set({ budgetMin: e.target.value })} />
          </Field>
          <Field label="Budget max">
            <Input inputMode="decimal" value={String(value('budgetMax'))} onChange={(e) => set({ budgetMax: e.target.value })} />
          </Field>
          <Field label="Campaign">
            <Select value={String(value('campaignId'))} onChange={(e) => set({ campaignId: e.target.value || undefined })}>
              <option value="">—</option>
              {campaigns.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {conflict ? (
            <Alert className="sm:col-span-2">Someone else saved this lead first. Close this window to reload the latest version, then edit again.</Alert>
          ) : update.error ? (
            <Alert className="sm:col-span-2">{errorMessage(update.error)}</Alert>
          ) : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending || Object.keys(form).length === 0}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
