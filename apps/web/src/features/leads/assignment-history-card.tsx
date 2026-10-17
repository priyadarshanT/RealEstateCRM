'use client';

import { Card, CardBody, CardHeader } from '@crm/ui';
import { ArrowRight } from 'lucide-react';
import { formatDateTime } from '@/core/format';
import { byId, useColleagues, useReasons } from '@/core/lookups';
import { useAssignments } from './leads-api';

/**
 * Assignment history (stakeholder update 2026-10-17): every time the lead moved between agents, who had it
 * (Assigned From), who received it (Assigned To), who or which rule made the move, and the date and time.
 */
export function AssignmentHistoryCard({ leadId, timeZone }: { leadId: string; timeZone?: string }) {
  const moves = useAssignments(leadId);
  const users = byId(useColleagues().data);
  const reasons = byId(useReasons('reassignment').data);
  const name = (id: string | null | undefined, empty: string) => (id ? (users.get(id)?.fullName ?? 'Former user') : empty);

  return (
    <Card>
      <CardHeader title={`Assignment history (${moves.data?.length ?? 0})`} />
      <CardBody className="space-y-2">
        {moves.data?.map((m) => (
          <div key={m.id} className="rounded border border-border p-2 text-xs">
            <p className="flex flex-wrap items-center gap-1 font-medium">
              <span>{name(m.fromUserId, 'Unassigned')}</span>
              <ArrowRight className="size-3 text-muted-foreground" aria-label="to" />
              <span>{name(m.toUserId, 'Unassigned')}</span>
            </p>
            <p className="text-muted-foreground">
              {formatDateTime(m.at, timeZone)} · by {m.byUserId ? name(m.byUserId, '') : `System (${m.method.replace(/_/g, ' ')})`}
            </p>
            {m.reasonId ? <p>Reason: {reasons.get(m.reasonId)?.name ?? '—'}</p> : null}
            {m.note ? <p className="text-muted-foreground">{m.note}</p> : null}
          </div>
        ))}
        {moves.data && !moves.data.length ? <p className="text-xs text-muted-foreground">Not assigned yet.</p> : null}
      </CardBody>
    </Card>
  );
}
