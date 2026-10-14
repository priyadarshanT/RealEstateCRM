'use client';

import { Alert, Button, Dialog, DialogContent, Field, Input, Loading, Select } from '@crm/ui';
import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { useMe } from '@/core/session';
import { CHANNEL_LABEL, useMyBookingPage, useSaveBookingPage, type MeetingChannel } from './calendar-api';

const DAYS = [
  ['sun', 'Sunday'],
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
] as const;
type Day = (typeof DAYS)[number][0];
type Hours = Partial<Record<Day, [string, string][]>>;
const DEFAULT: Hours = { mon: [['09:00', '18:00']], tue: [['09:00', '18:00']], wed: [['09:00', '18:00']], thu: [['09:00', '18:00']], fri: [['09:00', '18:00']] };

/** Each agent's own booking page (SRS §3.9, replaces Calendly): link name, meeting type, length and weekly hours. */
export function BookingPageEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const page = useMyBookingPage();
  const save = useSaveBookingPage();
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [channel, setChannel] = useState<MeetingChannel>('google_meet');
  const [duration, setDuration] = useState(30);
  const [buffer, setBuffer] = useState(10);
  const [notice, setNotice] = useState(2);
  const [hours, setHours] = useState<Hours>(DEFAULT);
  const [active, setActive] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || page.isLoading) return;
    const p = page.data;
    const name = me.data?.user.fullName ?? '';
    setSlug(p?.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60));
    setTitle(p?.title ?? `Book a call with ${name}`);
    setChannel((p?.meetingChannel as MeetingChannel) ?? 'google_meet');
    setDuration(p?.durationMinutes ?? 30);
    setBuffer(p?.bufferMinutes ?? 10);
    setNotice(p?.minNoticeHours ?? 2);
    setHours(p && Object.keys(p.weeklyHours ?? {}).length ? (p.weeklyHours as Hours) : DEFAULT);
    setActive(p?.isActive ?? true);
    save.reset();
  }, [open, page.isLoading, page.data?.id]);

  const toggleDay = (d: Day, on: boolean) => setHours((h) => ({ ...Object.fromEntries(Object.entries(h).filter(([k]) => k !== d)), ...(on ? { [d]: [['09:00', '18:00']] } : {}) }));
  const setTime = (d: Day, i: 0 | 1, v: string) => setHours((h) => ({ ...h, [d]: [[i === 0 ? v : h[d]![0]![0], i === 1 ? v : h[d]![0]![1]]] }));
  const taken = save.error instanceof ApiError && save.error.problem.code === 'SLUG_TAKEN';
  const publicUrl = save.data?.publicUrl ?? page.data?.publicUrl;

  async function copy() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="My booking page" wide>
        {page.isLoading ? (
          <Loading />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {publicUrl ? (
              <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm sm:col-span-2">
                <a href={publicUrl} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">
                  {publicUrl}
                </a>
                <Button variant="ghost" size="sm" onClick={copy} aria-label="Copy link">
                  <Copy /> {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground sm:col-span-2">Save the page to get your link. Clients pick a free time; the meeting, link and confirmation are created for you.</p>
            )}
            <Field label="Link name" error={taken ? 'Already used, choose another' : undefined}>
              <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
            </Field>
            <Field label="Page heading">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Meeting type">
              <Select value={channel} onChange={(e) => setChannel(e.target.value as MeetingChannel)}>
                {(Object.keys(CHANNEL_LABEL) as MeetingChannel[]).map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABEL[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Length (minutes)">
              <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[15, 20, 30, 45, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Gap between meetings (minutes)">
              <Input type="number" min={0} max={240} value={buffer} onChange={(e) => setBuffer(Number(e.target.value))} />
            </Field>
            <Field label="Earliest booking (hours from now)">
              <Input type="number" min={0} max={720} value={notice} onChange={(e) => setNotice(Number(e.target.value))} />
            </Field>
            <div className="space-y-1.5 sm:col-span-2">
              <p className="text-xs font-medium text-muted-foreground">Bookable hours ({me.data?.tenant.timezone ?? 'company time zone'})</p>
              {DAYS.map(([d, label]) => {
                const range = hours[d]?.[0];
                return (
                  <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
                    <label className="flex w-32 items-center gap-2">
                      <input type="checkbox" checked={!!range} onChange={(e) => toggleDay(d, e.target.checked)} /> {label}
                    </label>
                    {range ? (
                      <>
                        <Input type="time" className="h-8 w-28" value={range[0]} onChange={(e) => setTime(d, 0, e.target.value)} aria-label={`${label} from`} />
                        <span>to</span>
                        <Input type="time" className="h-8 w-28" value={range[1]} onChange={(e) => setTime(d, 1, e.target.value)} aria-label={`${label} to`} />
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not bookable</span>
                    )}
                  </div>
                );
              })}
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Page is on (clients can book)
            </label>
            {save.error && !taken ? <Alert className="sm:col-span-2">{errorMessage(save.error)}</Alert> : null}
            {save.isSuccess ? <Alert tone="success" className="sm:col-span-2">Saved. Share your link with clients.</Alert> : null}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button
                disabled={save.isPending || slug.length < 3 || !title.trim()}
                onClick={() =>
                  save.mutate({ slug, title: title.trim(), meetingChannel: channel, durationMinutes: duration, bufferMinutes: buffer, minNoticeHours: notice, weeklyHours: hours, isActive: active })
                }
              >
                Save page
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
