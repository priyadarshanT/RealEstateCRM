'use client';

import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Loading, Textarea, cn } from '@crm/ui';
import { Check, Plus } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/core/api';
import { formatDateTime } from '@/core/format';
import { byId, useCampaigns, useColleagues, useSources, useStages } from '@/core/lookups';
import { useCan, useMe } from '@/core/session';
import { CampaignEditor } from './campaign-editor';
import { STATUS_LABEL, STATUS_TONE, useCampaignActions, useCampaignList, useCampaignReport, type Campaign } from './campaigns-api';
import { CHANNEL_LABEL, useTemplates } from './messaging-api';

/**
 * Bulk campaigns (SRS §5.3–5.5, wireframe "WhatsApp and email" right panel): audience, template, test, manager
 * approval, sending and the result (sent, delivered, replied, failed, opted out).
 */
export function CampaignsPanel() {
  const can = useCan();
  const list = useCampaignList();
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  const open = list.data?.find((c) => c.id === openId) ?? list.data?.[0] ?? null;

  return (
    <div className="grid gap-3 lg:grid-cols-[20rem_1fr]">
      <div className="space-y-2">
        {can('campaigns.create') ? (
          <Button size="sm" className="w-full" onClick={() => setEditing('new')}>
            <Plus /> New campaign
          </Button>
        ) : null}
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {list.isLoading ? <Loading /> : null}
          {list.error ? <Alert className="m-2">{errorMessage(list.error)}</Alert> : null}
          {list.data?.length === 0 ? <EmptyState title="No campaigns yet" /> : null}
          {list.data?.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setOpenId(c.id)}
              className={cn('block w-full border-b border-border px-3 py-2.5 text-left hover:bg-muted/60', c.id === open?.id && 'bg-primary/10')}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{c.name}</span>
                <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
              </span>
              <span className="text-xs text-muted-foreground">
                {CHANNEL_LABEL[c.channel]}
                {c.audienceCount !== null && c.audienceCount !== undefined ? ` · ${leads(c.audienceCount)}` : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
      {open ? <CampaignDetail campaign={open} onEdit={() => setEditing(open)} /> : <div />}
      {editing ? <CampaignEditor key={editing === 'new' ? 'new' : editing.id} campaign={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function CampaignDetail({ campaign: c, onEdit }: { campaign: Campaign; onEdit: () => void }) {
  const can = useCan();
  const me = useMe();
  const a = useCampaignActions();
  const templates = byId(useTemplates().data);
  const stages = byId(useStages().data);
  const sources = byId(useSources().data);
  const adCampaigns = byId(useCampaigns().data);
  const people = byId(useColleagues().data);
  const report = useCampaignReport(c.id, ['sending', 'completed'].includes(c.status));
  const [testTo, setTestTo] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const mine = c.createdBy === me.data?.user.id;
  const f = c.audienceFilter as Record<string, string>;
  const audience = [
    f.tab ? `Tab = ${f.tab}` : null,
    f.stageId ? `Stage = ${stages.get(f.stageId)?.name ?? '?'}` : null,
    f.sourceId ? `Source = ${sources.get(f.sourceId)?.name ?? '?'}` : null,
    f.campaignId ? `Ad campaign = ${adCampaigns.get(f.campaignId)?.name ?? '?'}` : null,
    f.createdFrom || f.createdTo ? `Created ${f.createdFrom ?? '…'} – ${f.createdTo ?? '…'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const steps: [string, boolean][] = [
    ['Draft', true],
    ['Test sent', c.status !== 'draft' || a.test.isSuccess],
    ['Approved', ['approved', 'sending', 'completed'].includes(c.status)],
    ['Sent', c.status === 'completed'],
  ];
  const error = a.preview.error ?? a.test.error ?? a.submit.error ?? a.approve.error ?? a.reject.error ?? a.cancel.error;
  const editable = c.status === 'draft' || c.status === 'rejected';

  return (
    <Card>
      <CardHeader title="Bulk campaign" actions={<Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>} />
      <CardBody className="space-y-4">
        <dl className="grid grid-cols-[6.5rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Campaign</dt>
          <dd className="font-semibold">{c.name}</dd>
          <dt className="text-muted-foreground">Audience</dt>
          <dd>
            {audience || 'All leads the creator can see'}
            {c.audienceCount !== null && c.audienceCount !== undefined ? <span className="block text-xs text-muted-foreground">{leads(c.audienceCount)} after opt-outs</span> : null}
          </dd>
          <dt className="text-muted-foreground">Template</dt>
          <dd>
            {templates.get(c.templateId)?.name ?? '—'} ({CHANNEL_LABEL[c.channel]})
          </dd>
          <dt className="text-muted-foreground">Send</dt>
          <dd>{c.scheduledAt ? formatDateTime(c.scheduledAt) : 'As soon as approved'}</dd>
          <dt className="text-muted-foreground">Created by</dt>
          <dd>{people.get(c.createdBy ?? '')?.fullName ?? '—'}</dd>
          {c.approvedBy ? (
            <>
              <dt className="text-muted-foreground">{c.status === 'rejected' ? 'Rejected by' : 'Approved by'}</dt>
              <dd>{people.get(c.approvedBy)?.fullName ?? '—'}</dd>
            </>
          ) : null}
        </dl>
        <div className="flex flex-wrap gap-1.5">
          {steps.map(([label, done]) => (
            <span key={label} className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs', done ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>
              {label} {done ? <Check className="size-3" /> : null}
            </span>
          ))}
        </div>
        {c.status === 'rejected' && c.rejectionNote ? <Alert tone="warning">Rejected: {c.rejectionNote}. Edit the campaign and send a new test.</Alert> : null}

        {report.data ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {(
              [
                ['Sent', report.data.sent],
                ['Delivered', report.data.delivered],
                ['Replied', report.data.replied],
                ['Failed', report.data.failed],
                ['Opted out', report.data.optedOut],
                ['Left out', report.data.skippedOptedOut],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="rounded-md bg-muted/60 px-2 py-2 text-center">
                <p className="text-lg font-semibold tabular-nums">{n}</p>
                <p className="text-[11px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        ) : null}

        {a.preview.data ? (
          <Alert tone="info">
            {leads(a.preview.data.count ?? 0)} will receive it; {a.preview.data.excludedOptedOut} opted out and {a.preview.data.excludedOptedOut === 1 ? 'is' : 'are'} left out.
            {a.preview.data.sample?.length ? ` For example: ${a.preview.data.sample.map((s) => s.name).join(', ')}.` : ''}
          </Alert>
        ) : null}
        {a.test.isSuccess ? <Alert tone="success">Test sent. Check it, then submit for approval.</Alert> : null}
        {error ? <Alert>{errorMessage(error)}</Alert> : null}

        {editable && can('campaigns.create') ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={onEdit}>
                Edit
              </Button>
              <Button variant="outline" size="sm" disabled={a.preview.isPending} onClick={() => a.preview.mutate(c.id)}>
                Preview audience
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label={c.channel === 'whatsapp' ? 'Send a test to (phone)' : 'Send a test to (email)'}>
                <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={c.channel === 'whatsapp' ? '+971501234567' : 'you@company.ae'} />
              </Field>
              <Button variant="outline" size="sm" disabled={!testTo.trim() || a.test.isPending} onClick={() => a.test.mutate({ id: c.id, to: testTo.trim() })}>
                Send test
              </Button>
              <Button size="sm" disabled={a.submit.isPending} onClick={() => a.submit.mutate(c.id)}>
                Submit for approval
              </Button>
            </div>
          </div>
        ) : null}

        {c.status === 'pending_approval' && can('campaigns.approve') ? (
          mine ? (
            <p className="text-sm text-muted-foreground">Waiting for another manager to approve your campaign.</p>
          ) : (
            <div className="space-y-2">
              <Field label="Rejection note (needed to reject)">
                <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} className="min-h-14" />
              </Field>
              <div className="flex gap-2">
                <Button size="sm" disabled={a.approve.isPending} onClick={() => a.approve.mutate(c.id)}>
                  Approve and send
                </Button>
                <Button variant="outline" size="sm" disabled={!rejectNote.trim() || a.reject.isPending} onClick={() => a.reject.mutate({ id: c.id, note: rejectNote.trim() })}>
                  Reject
                </Button>
              </div>
            </div>
          )
        ) : null}

        {['draft', 'pending_approval', 'approved', 'rejected'].includes(c.status) && can('campaigns.create') ? (
          <Button variant="link" size="sm" className="text-danger" onClick={() => window.confirm(`Cancel ${c.name}? It will not be sent.`) && a.cancel.mutate(c.id)}>
            Cancel campaign
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}

function leads(n: number): string {
  return `${n} ${n === 1 ? 'lead' : 'leads'}`;
}
