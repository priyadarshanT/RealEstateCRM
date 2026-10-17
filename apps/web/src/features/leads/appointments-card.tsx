'use client';

import { Badge, Card, CardBody, CardHeader, Loading } from '@crm/ui';
import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { formatDateTime } from '@/core/format';
import { CHANNEL_LABEL, TYPE_LABEL, useLeadMeetings } from '@/features/calendar/calendar-api';
import { MeetingDetailDialog } from '@/features/calendar/meeting-detail-dialog';

/** The lead's appointments (Lead page §3.6–3.8): open one to reschedule, cancel or mark it done; history stays. */
export function AppointmentsCard({ leadId, timeZone }: { leadId: string; timeZone?: string }) {
  const meetings = useLeadMeetings(leadId);
  const [open, setOpen] = useState<string | null>(null);
  const rows = [...(meetings.data ?? [])].sort((a, b) => {
    if ((a.status === 'scheduled') !== (b.status === 'scheduled')) return a.status === 'scheduled' ? -1 : 1;
    return a.status === 'scheduled' ? a.startsAt.localeCompare(b.startsAt) : b.startsAt.localeCompare(a.startsAt);
  });
  if (!meetings.isLoading && rows.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Appointments" />
      <CardBody className="space-y-1.5">
        {meetings.isLoading ? <Loading /> : null}
        {rows.slice(0, 8).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setOpen(m.id)}
            className="flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-sm hover:bg-muted"
          >
            <CalendarClock className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{TYPE_LABEL[m.type]}</span>
              <span className="text-muted-foreground"> · {formatDateTime(m.startsAt, timeZone)} · {CHANNEL_LABEL[m.channel]}</span>
            </span>
            <Badge tone={m.status === 'scheduled' ? 'primary' : m.status === 'completed' ? 'success' : 'neutral'}>{m.status.replace('_', ' ')}</Badge>
          </button>
        ))}
      </CardBody>
      {open ? <MeetingDetailDialog meetingId={open} timeZone={timeZone} onClose={() => setOpen(null)} /> : null}
    </Card>
  );
}
