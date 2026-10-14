'use client';

import { Alert, Badge, Button, Loading } from '@crm/ui';
import { AlarmClock, ArrowLeft, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { errorMessage } from '@/core/api';
import { formatRelativeDay } from '@/core/format';
import { useCan, useMe } from '@/core/session';
import { LeadActions } from './lead-actions';
import { ConsentCard } from '@/features/messaging/consent-card';
import { EnquiriesCard, LeadDetailsCard, ScoreCard } from './lead-details-card';
import { LeadProjectsCard } from './lead-projects-card';
import { DealsCard } from '@/features/deals/deals-card';
import { LeadTimeline } from './lead-timeline';
import { useLead, useLeadMutations } from './leads-api';
import { StageBar } from './stage-bar';

export function LeadPageScreen({ id }: { id: string }) {
  const lead = useLead(id);
  const can = useCan();
  const me = useMe();
  const { remove, restore } = useLeadMutations(id);
  const tz = me.data?.user.timezone;

  if (lead.isLoading) return <Loading />;
  if (lead.error || !lead.data) return <Alert>{errorMessage(lead.error)}</Alert>;
  const l = lead.data;
  // Shared "view only" users cannot change anything (SRS §2.17).
  const canEdit = can('leads.edit') && l.access !== 'view' && !l.deletedAt;
  const overdue = l.nextFollowUpAt && Date.parse(l.nextFollowUpAt) < Date.now();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/leads" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Leads
        </Link>
        <h1 className="text-lg font-semibold">{l.fullName}</h1>
        {l.access === 'view' ? <Badge tone="info">Shared · view only</Badge> : l.access === 'edit' ? <Badge tone="info">Shared · can edit</Badge> : null}
        {l.deletedAt ? <Badge tone="danger">Deleted</Badge> : null}
        <span className="ml-auto" />
        {can('leads.delete') && (l.access === 'owner' || l.access === 'scope') ? (
          l.deletedAt ? (
            <Button variant="outline" size="sm" disabled={restore.isPending} onClick={() => restore.mutate()}>
              <RotateCcw /> Restore
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="text-danger"
              disabled={remove.isPending}
              onClick={() => window.confirm(`Delete ${l.fullName}? It can be restored from the Deleted tab.`) && remove.mutate()}
            >
              <Trash2 /> Delete
            </Button>
          )
        ) : null}
      </div>
      {remove.error || restore.error ? <Alert>{errorMessage(remove.error ?? restore.error)}</Alert> : null}

      <div className="grid gap-3 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-3">
          <LeadDetailsCard lead={l} canEdit={canEdit} />
          <LeadProjectsCard lead={l} canEdit={canEdit} />
          <DealsCard leadId={l.id} canEdit={canEdit} />
          <ScoreCard score={l.score} />
          <ConsentCard leadId={l.id} canEdit={canEdit} timeZone={tz} />
          <EnquiriesCard leadId={l.id} />
        </div>
        <div className="space-y-3">
          <StageBar lead={l} canEdit={canEdit} />
          <LeadActions lead={l} canEdit={canEdit} />
          {l.nextFollowUpAt ? (
            <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${overdue ? 'border-danger/30 bg-danger/5' : 'border-amber-300 bg-amber-50'}`}>
              <AlarmClock className="size-4" />
              <b>Next follow-up:</b> {formatRelativeDay(l.nextFollowUpAt, tz)}
              {overdue ? <span className="font-medium text-danger">(overdue)</span> : null}
            </div>
          ) : null}
          {l.responseDueAt && Date.parse(l.responseDueAt) > Date.now() ? (
            <Alert tone="warning">New lead: act before {formatRelativeDay(l.responseDueAt, tz)} or it moves to the next agent.</Alert>
          ) : null}
          <LeadTimeline leadId={l.id} timeZone={tz} />
        </div>
      </div>
    </div>
  );
}
