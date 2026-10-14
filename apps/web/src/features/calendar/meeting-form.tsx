'use client';

import { Alert, Button, Field, Input, Select, cn } from '@crm/ui';
import { useMemo, useState } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { formatTime, isoToLocalInput, localInputToIso } from '@/core/format';
import { useColleagues } from '@/core/lookups';
import { useCan, useMe } from '@/core/session';
import { CHANNEL_LABEL, useAvailability, useMeetingActions, type MeetingChannel } from './calendar-api';

const DURATIONS = [15, 30, 45, 60, 90, 120];

/**
 * Meeting or viewing with a lead (SRS §3.8–3.11): Google Meet / Teams link from the agent's account, or in person /
 * phone; free times of the agent are suggested and double booking is refused by the server (AGENT_BUSY).
 */
export function MeetingForm({ leadId, type, onDone }: { leadId: string; type: 'meeting' | 'viewing'; onDone: () => void }) {
  const me = useMe();
  const can = useCan();
  const colleagues = useColleagues();
  const { create } = useMeetingActions();
  const [organizer, setOrganizer] = useState(me.data?.user.id ?? '');
  const [channel, setChannel] = useState<MeetingChannel>(type === 'viewing' ? 'in_person' : 'google_meet');
  const [start, setStart] = useState(() => isoToLocalInput(roundedSoon()));
  const [duration, setDuration] = useState(type === 'viewing' ? 60 : 30);
  const [location, setLocation] = useState('');
  const [confirm, setConfirm] = useState(true);
  const day = useMemo(() => {
    const d = new Date(localInputToIso(start));
    d.setHours(0, 0, 0, 0);
    return { from: d.toISOString(), to: new Date(d.getTime() + 86_400_000).toISOString() };
  }, [start]);
  const free = useAvailability(organizer || me.data?.user.id, day.from, day.to, duration);
  const freeStarts = (free.data ?? []).flatMap((s) => (s.startsAt ? [s.startsAt] : []));
  const busy = create.error instanceof ApiError && create.error.problem.code === 'AGENT_BUSY';

  async function submit() {
    const startsAt = localInputToIso(start);
    const endsAt = new Date(new Date(startsAt).getTime() + duration * 60_000).toISOString();
    const ok = await create
      .mutateAsync({
        leadId,
        organizerUserId: organizer || me.data!.user.id,
        type,
        channel,
        startsAt,
        endsAt,
        clientTimezone: me.data?.tenant.timezone ?? 'Asia/Dubai',
        sendConfirmation: confirm,
        ...(location.trim() ? { location: location.trim() } : {}),
      })
      .catch(() => null);
    if (ok) onDone();
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="How">
        <Select value={channel} onChange={(e) => setChannel(e.target.value as MeetingChannel)}>
          {(Object.keys(CHANNEL_LABEL) as MeetingChannel[]).map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABEL[c]}
            </option>
          ))}
        </Select>
      </Field>
      {can('leads.assign') ? (
        <Field label="With">
          <Select value={organizer} onChange={(e) => setOrganizer(e.target.value)}>
            {colleagues.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Starts">
        <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
      </Field>
      <Field label="Length">
        <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
          {DURATIONS.map((d) => (
            <option key={d} value={d}>
              {d < 60 ? `${d} min` : `${d / 60} h`}
            </option>
          ))}
        </Select>
      </Field>
      {freeStarts.length ? (
        <div className="sm:col-span-2">
          <p className="mb-1 text-xs text-muted-foreground">Free that day</p>
          <div className="flex flex-wrap gap-1.5">
            {freeStarts.slice(0, 16).map((startsAt) => (
              <button
                key={startsAt}
                type="button"
                onClick={() => setStart(isoToLocalInput(startsAt))}
                className={cn('rounded-md border px-2 py-1 text-xs', localInputToIso(start) === startsAt ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted')}
              >
                {formatTime(startsAt, me.data?.user.timezone)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {channel === 'in_person' || type === 'viewing' ? (
        <Field label={type === 'viewing' ? 'Property / address' : 'Place'} className="sm:col-span-2">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Emaar Beachfront, Tower 2, unit 1204" />
        </Field>
      ) : null}
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> Email the client a confirmation{channel === 'google_meet' || channel === 'teams' ? ' with the link' : ''}
      </label>
      {busy ? <Alert className="sm:col-span-2">This person already has a meeting then. Pick a free time above.</Alert> : create.error ? <Alert className="sm:col-span-2">{errorMessage(create.error)}</Alert> : null}
      <div className="flex justify-end sm:col-span-2">
        <Button disabled={create.isPending} onClick={submit}>
          {create.isPending ? 'Booking…' : type === 'viewing' ? 'Book viewing' : 'Book meeting'}
        </Button>
      </div>
    </div>
  );
}

function roundedSoon(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d.toISOString();
}
