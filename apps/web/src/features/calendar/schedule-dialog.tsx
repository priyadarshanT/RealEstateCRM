'use client';

import { Alert, Button, Dialog, DialogContent, Field, Input, Select, Textarea, cn } from '@crm/ui';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { formatTime, isoToLocalInput, localInputToIso } from '@/core/format';
import { useColleagues } from '@/core/lookups';
import { useCan, useMe } from '@/core/session';
import { useClientPolicy } from '@/features/global-config/policy';
import { CHANNEL_LABEL, TYPE_LABEL, useAvailability, useMeetingActions, type MeetingChannel, type MeetingType } from './calendar-api';

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];
const ZONES = ['Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Asia/Karachi', 'Asia/Shanghai', 'Asia/Singapore', 'Europe/London', 'Europe/Paris', 'Europe/Moscow', 'America/New_York', 'Australia/Sydney'];

/** How each type happens by default, and which channels it offers. */
const CHANNELS: Record<MeetingType, MeetingChannel[]> = {
  call: ['phone'],
  meeting: ['online_link', 'google_meet', 'teams', 'in_person'],
  event: ['in_person', 'online_link'],
  viewing: ['in_person'],
};

export interface ScheduleInitial {
  type?: MeetingType;
  startsAt?: string;
}

/**
 * Schedule (Lead page §3.5–3.8): appointment type, date and time, time zone, duration, assigned agent, notes, and
 * the place or meeting link. Only Hot and Warm leads; past dates follow Enable Past Date Selection; the agent's
 * free times are suggested and double booking is refused.
 */
export function ScheduleDialog({ leadId, leadName, open, initial, onClose }: { leadId: string; leadName: string; open: boolean; initial?: ScheduleInitial; onClose: () => void }) {
  const me = useMe();
  const can = useCan();
  const policy = useClientPolicy();
  const colleagues = useColleagues();
  const { create } = useMeetingActions();
  const [type, setType] = useState<MeetingType>('call');
  const [channel, setChannel] = useState<MeetingChannel>('phone');
  const [organizer, setOrganizer] = useState('');
  const [start, setStart] = useState('');
  const [zone, setZone] = useState('Asia/Dubai');
  const [duration, setDuration] = useState(30);
  const [location, setLocation] = useState('');
  const [link, setLink] = useState('');
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState(true);

  useEffect(() => {
    if (!open) return;
    const t = initial?.type ?? 'call';
    setType(t);
    setChannel(CHANNELS[t][0]!);
    setOrganizer(me.data?.user.id ?? '');
    setStart(isoToLocalInput(initial?.startsAt ?? roundedSoon()));
    setZone(me.data?.tenant.timezone ?? 'Asia/Dubai');
    setDuration(t === 'viewing' || t === 'event' ? 60 : 30);
    setLocation('');
    setLink('');
    setNotes('');
    setConfirm(true);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const day = useMemo(() => {
    if (!start) return { from: new Date().toISOString(), to: new Date().toISOString() };
    const d = new Date(localInputToIso(start));
    d.setHours(0, 0, 0, 0);
    return { from: d.toISOString(), to: new Date(d.getTime() + 86_400_000).toISOString() };
  }, [start]);
  const free = useAvailability(organizer || me.data?.user.id, day.from, day.to, duration);
  const freeStarts = (free.data ?? []).flatMap((s) => (s.startsAt ? [s.startsAt] : []));
  const minStart = policy.data?.pastDateSelection ? undefined : isoToLocalInput(new Date().toISOString());
  const busy = create.error instanceof ApiError && create.error.problem.code === 'AGENT_BUSY';
  const needsLink = channel === 'online_link';
  const needsPlace = channel === 'in_person';

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
        clientTimezone: zone,
        sendConfirmation: confirm,
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(needsLink ? { joinUrl: link.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      .catch(() => null);
    if (ok) onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={`Schedule · ${leadName}`} wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Appointment type">
            <Select
              value={type}
              onChange={(e) => {
                const t = e.target.value as MeetingType;
                setType(t);
                setChannel(CHANNELS[t][0]!);
                setDuration(t === 'viewing' || t === 'event' ? 60 : 30);
              }}
            >
              {(Object.keys(TYPE_LABEL) as MeetingType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="How">
            <Select value={channel} onChange={(e) => setChannel(e.target.value as MeetingChannel)} disabled={CHANNELS[type].length === 1}>
              {CHANNELS[type].map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date and time">
            <Input type="datetime-local" min={minStart} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Client time zone">
            <Select value={zone} onChange={(e) => setZone(e.target.value)}>
              {[...new Set([zone, ...ZONES])].map((z) => (
                <option key={z} value={z}>
                  {z.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Duration">
            <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d < 60 ? `${d} min` : `${d / 60} h`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assigned agent">
            <Select value={organizer} onChange={(e) => setOrganizer(e.target.value)} disabled={!can('leads.assign')}>
              {(colleagues.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
          </Field>
          {freeStarts.length ? (
            <div className="sm:col-span-2">
              <p className="mb-1 text-xs text-muted-foreground">Free that day</p>
              <div className="flex flex-wrap gap-1.5">
                {freeStarts.slice(0, 16).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStart(isoToLocalInput(s))}
                    className={cn('rounded-md border px-2 py-1 text-xs', localInputToIso(start) === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted')}
                  >
                    {formatTime(s, me.data?.user.timezone)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {needsLink ? (
            <Field label="Meeting link * (e.g. your Zoom link)" className="sm:col-span-2">
              <Input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://zoom.us/j/..." />
            </Field>
          ) : null}
          {needsPlace ? (
            <Field label={type === 'viewing' ? 'Property / address' : 'Place'} className="sm:col-span-2">
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={type === 'viewing' ? 'Emaar Beachfront, Tower 2, unit 1204' : 'Office, event venue…'} />
            </Field>
          ) : null}
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> Email the client a confirmation
          </label>
          {busy ? (
            <Alert className="sm:col-span-2">The agent already has an appointment then. Pick a free time above.</Alert>
          ) : create.error ? (
            <Alert className="sm:col-span-2">{errorMessage(create.error)}</Alert>
          ) : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={create.isPending || !start || (needsLink && !/^https:\/\/\S{4,}$/.test(link.trim()))} onClick={submit}>
              {create.isPending ? 'Scheduling…' : 'Schedule'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function roundedSoon(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d.toISOString();
}
