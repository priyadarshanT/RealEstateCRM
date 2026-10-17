'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Field, Input, Loading, Select, Textarea } from '@crm/ui';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { formatDateTime, isoToLocalInput, localInputToIso } from '@/core/format';
import { byId, useColleagues } from '@/core/lookups';
import { CHANNEL_LABEL, TYPE_LABEL, useMeeting, useMeetingActions } from './calendar-api';

type Mode = 'view' | 'move' | 'cancel' | 'done';

/** A meeting or viewing from the calendar: join link, reschedule, cancel, held / no-show with the next action. */
export function MeetingDetailDialog({ meetingId, onClose, timeZone }: { meetingId: string; onClose: () => void; timeZone?: string }) {
  const meeting = useMeeting(meetingId);
  const people = byId(useColleagues().data);
  const a = useMeetingActions();
  const [mode, setMode] = useState<Mode>('view');
  const [start, setStart] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<'completed' | 'no_show'>('completed');
  const [note, setNote] = useState('');
  const [next, setNext] = useState<'' | 'call' | 'follow_up' | 'meeting' | 'viewing'>('follow_up');
  const [nextAt, setNextAt] = useState(() => isoToLocalInput(new Date(Date.now() + 2 * 86_400_000).toISOString()));
  const m = meeting.data;
  const error = a.reschedule.error ?? a.cancel.error ?? a.complete.error;
  const busy = error instanceof ApiError && error.problem.code === 'AGENT_BUSY';

  async function run(work: Promise<unknown>) {
    if (await work.catch(() => null)) onClose();
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={m ? `${TYPE_LABEL[m.type]} · ${CHANNEL_LABEL[m.channel]}` : 'Appointment'}>
        {meeting.isLoading ? <Loading /> : null}
        {meeting.error ? <Alert>{errorMessage(meeting.error)}</Alert> : null}
        {m ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={m.status === 'scheduled' ? 'primary' : m.status === 'completed' ? 'success' : 'neutral'}>{m.status.replace('_', ' ')}</Badge>
              <span>
                {formatDateTime(m.startsAt, timeZone)} – {formatDateTime(m.endsAt, timeZone)}
              </span>
              {m.bookedVia === 'booking_page' ? <Badge tone="info">Booked by the client</Badge> : null}
            </div>
            <p>
              <span className="text-muted-foreground">With:</span> {people.get(m.organizerUserId)?.fullName ?? '—'} ·{' '}
              <Link href={`/leads/${m.leadId}`} className="text-primary hover:underline" onClick={onClose}>
                Open lead
              </Link>
            </p>
            {m.joinUrl ? (
              <a href={m.joinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                Join {CHANNEL_LABEL[m.channel]} <ExternalLink className="size-3.5" />
              </a>
            ) : null}
            {m.location ? <p><span className="text-muted-foreground">Place:</span> {m.location}</p> : null}
            {m.clientTimezone ? <p className="text-xs text-muted-foreground">Client time zone: {m.clientTimezone}</p> : null}
            {m.cancelReason ? <p><span className="text-muted-foreground">Cancelled:</span> {m.cancelReason}</p> : null}
            {m.notes ? <p><span className="text-muted-foreground">Notes:</span> {m.notes}</p> : null}

            {mode === 'move' ? (
              <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
                <Field label="New start">
                  <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
                </Field>
                <Button size="sm" disabled={!start || a.reschedule.isPending} onClick={() => run(a.reschedule.mutateAsync({ id: m.id, startsAt: localInputToIso(start) }))}>
                  Move
                </Button>
              </div>
            ) : null}
            {mode === 'cancel' ? (
              <div className="space-y-2 rounded-md border border-border p-3">
                <Field label="Reason *">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Client asked to cancel" />
                </Field>
                <Button size="sm" variant="danger" disabled={!reason.trim() || a.cancel.isPending} onClick={() => run(a.cancel.mutateAsync({ id: m.id, reason: reason.trim() }))}>
                  Cancel {m.type}
                </Button>
              </div>
            ) : null}
            {mode === 'done' ? (
              <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2">
                <Field label="Result">
                  <Select value={result} onChange={(e) => setResult(e.target.value as 'completed' | 'no_show')}>
                    <option value="completed">Held</option>
                    <option value="no_show">Client did not come</option>
                  </Select>
                </Field>
                <Field label="Next action">
                  <Select value={next} onChange={(e) => setNext(e.target.value as typeof next)}>
                    <option value="">None</option>
                    <option value="call">Call</option>
                    <option value="follow_up">Follow-up</option>
                    <option value="meeting">Meeting</option>
                    <option value="viewing">Viewing</option>
                  </Select>
                </Field>
                {next ? (
                  <Field label="When" className="sm:col-span-2">
                    <Input type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} />
                  </Field>
                ) : null}
                <Field label="Note" className="sm:col-span-2">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <div className="sm:col-span-2">
                  <Button
                    size="sm"
                    disabled={a.complete.isPending}
                    onClick={() =>
                      run(
                        a.complete.mutateAsync({
                          id: m.id,
                          status: result,
                          ...(note.trim() ? { note: note.trim() } : {}),
                          ...(next ? { nextAction: { type: next, dueAt: localInputToIso(nextAt) } } : {}),
                        }),
                      )
                    }
                  >
                    Save result
                  </Button>
                </div>
              </div>
            ) : null}

            {busy ? <Alert>The agent already has a meeting then. Pick another time.</Alert> : error ? <Alert>{errorMessage(error)}</Alert> : null}
            {m.status === 'scheduled' && mode === 'view' ? (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setMode('cancel')}>
                  Cancel
                </Button>
                <Button variant="outline" size="sm" onClick={() => (setStart(isoToLocalInput(m.startsAt)), setMode('move'))}>
                  Reschedule
                </Button>
                <Button size="sm" onClick={() => setMode('done')}>
                  Record result
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
