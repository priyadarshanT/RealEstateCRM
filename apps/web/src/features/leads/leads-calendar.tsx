'use client';

import { Alert, Button, Loading, cn } from '@crm/ui';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { ymd } from '@/core/date-range';
import { formatTime } from '@/core/format';
import { TYPE_LABEL, useMeetingsInRange } from '@/features/calendar/calendar-api';
import { rangeFor, sameDay, shift, type CalendarView } from '@/features/tasks/calendar-range';
import type { LeadQuery } from './leads-api';

type View = Exclude<CalendarView, 'list'>;
const VIEWS: { key: View; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: 'day', label: 'Day' },
];

interface Entry {
  key: string;
  at: Date;
  leadId: string;
  label: string;
  kind: 'follow_up' | 'appointment';
}

/**
 * Calendar View of the Lead page (§8.6–8.7): follow-ups of the leads matching the list's search and filters, and
 * appointments in the user's access, by month, week or day. An entry opens its lead. The list's filters stay as
 * they are when switching between list and calendar.
 */
export function LeadsCalendar({ query, timeZone }: { query: LeadQuery; timeZone?: string }) {
  const router = useRouter();
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const { tab: _tab, dateField: _f, dateFrom: _a, dateTo: _b, cursor: _c, ...filters } = query as LeadQuery & { cursor?: string };

  const followUps = useQuery({
    queryKey: ['leads', 'calendar', filters, range.from.toISOString(), range.to.toISOString()],
    queryFn: async () =>
      unwrap(
        await api.GET('/leads', {
          params: { query: { ...filters, tab: 'all', dateField: 'follow_up', dateFrom: ymd(range.from), dateTo: ymd(new Date(range.to.getTime() - 1)), limit: 200 } },
        }),
      ).data,
  });
  const meetings = useMeetingsInRange(range.from.toISOString(), range.to.toISOString());
  const leadNames = new Map((followUps.data ?? []).map((l) => [l.id, l.fullName]));

  const entries: Entry[] = [
    ...(followUps.data ?? []).flatMap((l) => (l.nextFollowUpAt ? [{ key: `f-${l.id}`, at: new Date(l.nextFollowUpAt), leadId: l.id, label: l.fullName, kind: 'follow_up' as const }] : [])),
    ...(meetings.data ?? [])
      .filter((m) => m.status === 'scheduled' || m.status === 'completed')
      .filter((m) => !filters.ownerUserId || m.organizerUserId === filters.ownerUserId)
      .map((m) => ({ key: `m-${m.id}`, at: new Date(m.startsAt), leadId: m.leadId, label: `${TYPE_LABEL[m.type]}${leadNames.get(m.leadId) ? ` · ${leadNames.get(m.leadId)}` : ''}`, kind: 'appointment' as const })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const title =
    view === 'month'
      ? anchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      : view === 'week'
        ? `${range.days[0]!.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${range.days[6]!.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
        : anchor.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" onClick={() => setView(v.key)} className={cn('px-3 py-1.5 text-sm', view === v.key ? 'bg-primary font-semibold text-primary-foreground' : 'hover:bg-muted')}>
              {v.label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="icon" aria-label="Previous" onClick={() => setAnchor((a) => shift(view, a, -1))}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
          Today
        </Button>
        <Button variant="outline" size="icon" aria-label="Next" onClick={() => setAnchor((a) => shift(view, a, 1))}>
          <ChevronRight />
        </Button>
        <span className="font-semibold">{title}</span>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-amber-500" /> Follow-up
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-primary" /> Appointment
          </span>
        </span>
      </div>
      {followUps.error || meetings.error ? <Alert>{errorMessage(followUps.error ?? meetings.error)}</Alert> : null}
      {followUps.isLoading || meetings.isLoading ? <Loading /> : null}
      <div className={cn('grid gap-px overflow-hidden rounded-xl border border-border bg-border', view === 'day' ? 'grid-cols-1' : 'grid-cols-7')}>
        {view !== 'day'
          ? range.days.slice(0, 7).map((d) => (
              <div key={`h-${d.toISOString()}`} className="bg-muted/60 px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {d.toLocaleDateString('en-GB', { weekday: 'short' })}
              </div>
            ))
          : null}
        {range.days.map((d) => {
          const today = sameDay(d, new Date());
          const outside = view === 'month' && d.getMonth() !== anchor.getMonth();
          const own = entries.filter((e) => sameDay(e.at, d));
          const max = view === 'month' ? 3 : 50;
          return (
            <div key={d.toISOString()} className={cn('min-h-24 bg-surface p-1.5', view !== 'month' && 'min-h-64', outside && 'bg-muted/30 text-muted-foreground')}>
              <p className={cn('mb-1 text-xs font-medium', today && 'inline-flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground')}>{d.getDate()}</p>
              <div className="space-y-1">
                {own.slice(0, max).map((e) => (
                  <button
                    key={e.key}
                    type="button"
                    onClick={() => router.push(`/leads/${e.leadId}`)}
                    className={cn(
                      'flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px]',
                      e.kind === 'appointment' ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'bg-amber-100 text-amber-900 hover:bg-amber-200',
                    )}
                    title={`${e.label} · ${formatTime(e.at.toISOString(), timeZone)}`}
                  >
                    {e.kind === 'appointment' ? <CalendarClock className="size-3 shrink-0" /> : <AlarmClock className="size-3 shrink-0" />}
                    <span className="tabular-nums">{formatTime(e.at.toISOString(), timeZone)}</span>
                    <span className="truncate">{e.label}</span>
                  </button>
                ))}
                {own.length > max ? <p className="text-[11px] text-muted-foreground">+{own.length - max} more</p> : null}
              </div>
            </div>
          );
        })}
      </div>
      {(followUps.data?.length ?? 0) >= 200 ? <p className="text-xs text-muted-foreground">Showing the first 200 follow-ups; narrow the filters to see more.</p> : null}
    </div>
  );
}
