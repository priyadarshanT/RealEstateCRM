'use client';

import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, DialogContent, Field, Input, Select, TabStrip, Table, Td, Th, Tr } from '@crm/ui';
import { Camera, Download } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { openDownload, uploadFile } from '@/core/files';
import { formatDate, formatTime, localInputToIso } from '@/core/format';
import { byId, useColleagues } from '@/core/lookups';
import { useCan, useMe } from '@/core/session';
import {
  AttendanceRecord,
  currentPosition,
  DAY_STATUS_LABEL,
  DAY_STATUS_TONE,
  DayStatus,
  LEAVE_TONE,
  todayLocal,
  useAttendanceActions,
  useCorrections,
  useDefaultPolicy,
  useLeaveRequests,
  useLeaveTypes,
  useRecords,
} from './attendance-api';
import { AttendanceSetup } from './attendance-setup';

/** Attendance (SRS §9): check in / out with a live photo, my days, leave, team records, corrections and setup. */
export function AttendanceScreen() {
  const can = useCan();
  const params = useSearchParams();
  const router = useRouter();
  const tabs = [
    { key: 'today', label: 'Today' },
    { key: 'leave', label: 'Leave' },
    { key: 'team', label: 'Team records' },
    ...(can('attendance.approve') ? [{ key: 'corrections', label: 'Corrections' }] : []),
    ...(can('settings.manage') ? [{ key: 'setup', label: 'Office hours, holidays & leave types' }] : []),
  ];
  const tab = tabs.some((t) => t.key === params.get('tab')) ? params.get('tab')! : 'today';
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Attendance</h1>
      <TabStrip items={tabs} value={tab} onChange={(k) => router.replace(`/attendance?tab=${k}`)} />
      {tab === 'today' ? <Today /> : null}
      {tab === 'leave' ? <Leave /> : null}
      {tab === 'team' ? <TeamRecords /> : null}
      {tab === 'corrections' ? <Corrections /> : null}
      {tab === 'setup' ? <AttendanceSetup /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- today: check in / out and my days
function Today() {
  const me = useMe();
  const myId = me.data?.user.id;
  const policy = useDefaultPolicy();
  const monthStart = todayLocal().slice(0, 8) + '01';
  const mine = useRecords({ ...(myId ? { userId: myId } : {}), from: monthStart, to: todayLocal() }, !!myId);
  const today = mine.data?.find((r) => r.workDate === todayLocal());
  const a = useAttendanceActions();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'in' | 'out'>('in');
  const [wfh, setWfh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [correct, setCorrect] = useState<AttendanceRecord | null>(null);
  const p = policy.data?.default;

  async function onPhoto(file: File) {
    setBusy(true);
    setError(null);
    try {
      const photoFileId = await uploadFile(file, 'attendance_photo');
      const where = p?.locationRequired && !wfh ? await currentPosition() : undefined;
      const body = { photoFileId, ...(where ?? {}), ...(mode === 'in' && wfh ? { workFromHome: true } : {}) };
      await (mode === 'in' ? a.checkIn.mutateAsync(body) : a.checkOut.mutateAsync(body));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  const take = (m: 'in' | 'out') => {
    setMode(m);
    fileRef.current?.click();
  };
  const code = error instanceof ApiError ? error.problem.code : undefined;

  return (
    <div className="grid gap-3 lg:grid-cols-[22rem_1fr]">
      <Card>
        <CardHeader title={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} />
        <CardBody className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Office hours {p ? `${p.workStart}–${p.workEnd}` : '09:00–18:00'}
            {p?.graceMinutes ? ` · ${p.graceMinutes} min grace` : ''}
            {p?.locationRequired ? ' · location needed at the office' : ''}
          </p>
          {today ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={DAY_STATUS_TONE[today.status]}>{DAY_STATUS_LABEL[today.status]}</Badge>
              {today.checkInAt ? <span>In {formatTime(today.checkInAt)}</span> : null}
              {today.checkOutAt ? <span>· Out {formatTime(today.checkOutAt)}</span> : null}
            </div>
          ) : (
            <p>Not checked in yet.</p>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => e.target.files?.[0] && void onPhoto(e.target.files[0])} />
          {!today?.checkInAt ? (
            <>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={wfh} onChange={(e) => setWfh(e.target.checked)} /> Working from home today
              </label>
              <Button className="h-11 w-full" disabled={busy} onClick={() => take('in')}>
                <Camera /> {busy ? 'Saving…' : 'Check in with a selfie'}
              </Button>
            </>
          ) : !today.checkOutAt ? (
            <Button className="h-11 w-full" variant="outline" disabled={busy} onClick={() => take('out')}>
              <Camera /> {busy ? 'Saving…' : 'Check out with a selfie'}
            </Button>
          ) : (
            <Alert tone="success">Done for today.</Alert>
          )}
          {code === 'LOCATION_REQUIRED' ? (
            <Alert>Allow location in your browser to check in at the office.</Alert>
          ) : code === 'OUTSIDE_OFFICE_RADIUS' ? (
            <Alert>{(error as ApiError).problem.detail}</Alert>
          ) : error ? (
            <Alert>{errorMessage(error)}</Alert>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="My days this month" />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Status</Th>
                <Th>In</Th>
                <Th>Out</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(mine.data ?? []).map((r) => (
                <Tr key={r.id}>
                  <Td className="text-xs">{formatDate(r.workDate, 'UTC')}</Td>
                  <Td>
                    <Badge tone={DAY_STATUS_TONE[r.status]}>{DAY_STATUS_LABEL[r.status]}</Badge>
                    {r.isCorrected ? <span className="ml-1 text-xs text-muted-foreground">corrected</span> : null}
                  </Td>
                  <Td className="text-xs">{r.checkInAt ? formatTime(r.checkInAt) : '—'}</Td>
                  <Td className="text-xs">{r.checkOutAt ? formatTime(r.checkOutAt) : '—'}</Td>
                  <Td>
                    {r.status !== 'leave' ? (
                      <Button variant="link" size="sm" onClick={() => setCorrect(r)}>
                        Request correction
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
              {mine.data?.length === 0 ? (
                <tr>
                  <Td colSpan={5} className="text-center text-muted-foreground">
                    No days recorded this month.
                  </Td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </CardBody>
      </Card>
      {correct ? <CorrectionDialog record={correct} onClose={() => setCorrect(null)} /> : null}
    </div>
  );
}

function CorrectionDialog({ record, onClose }: { record: AttendanceRecord; onClose: () => void }) {
  const { requestCorrection } = useAttendanceActions();
  const [status, setStatus] = useState<DayStatus>(record.status === 'absent' ? 'present' : record.status);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Correction for ${formatDate(record.workDate, 'UTC')}`}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await requestCorrection
              .mutateAsync({
                id: record.id,
                requestedStatus: status,
                reason: reason.trim(),
                ...(checkIn ? { requestedCheckInAt: localInputToIso(`${record.workDate}T${checkIn}`) } : {}),
                ...(checkOut ? { requestedCheckOutAt: localInputToIso(`${record.workDate}T${checkOut}`) } : {}),
              })
              .catch(() => null);
            if (ok) onClose();
          }}
        >
          <Field label="Correct status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as DayStatus)}>
              {(['present', 'late', 'half_day', 'wfh', 'absent'] as DayStatus[]).map((s) => (
                <option key={s} value={s}>
                  {DAY_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in time">
              <Input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            </Field>
            <Field label="Check-out time">
              <Input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            </Field>
          </div>
          <Field label="Reason *">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Was at a client viewing" />
          </Field>
          <p className="text-xs text-muted-foreground">Your manager reviews it. The original entry is kept.</p>
          {requestCorrection.error ? <Alert>{errorMessage(requestCorrection.error)}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={reason.trim().length < 3 || requestCorrection.isPending}>
              Send request
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- leave
function Leave() {
  const can = useCan();
  const me = useMe();
  const myId = me.data?.user.id;
  const types = useLeaveTypes();
  const typeName = new Map((types.data ?? []).map((t) => [t.id, t.name]));
  const people = byId(useColleagues().data);
  const mine = useLeaveRequests(myId ? { userId: myId } : {});
  const pending = useLeaveRequests({ status: 'pending' });
  const a = useAttendanceActions();
  const [asking, setAsking] = useState(false);
  const toReview = (pending.data ?? []).filter((l) => l.userId !== myId);
  const error = a.reviewLeave.error ?? a.cancelLeave.error;

  return (
    <div className="space-y-3">
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      {can('attendance.approve') && toReview.length ? (
        <Card>
          <CardHeader title={`Waiting for your review (${toReview.length})`} />
          <CardBody>
            <Table>
              <tbody>
                {toReview.map((l) => (
                  <Tr key={l.id}>
                    <Td>{people.get(l.userId)?.fullName ?? '—'}</Td>
                    <Td className="text-xs">{typeName.get(l.leaveTypeId) ?? 'Leave'}</Td>
                    <Td className="text-xs">
                      {formatDate(l.startDate, 'UTC')}
                      {l.endDate !== l.startDate ? ` – ${formatDate(l.endDate, 'UTC')}` : ''}
                      {l.isHalfDay ? ' (half day)' : ''}
                    </Td>
                    <Td className="text-xs text-muted-foreground">{l.reason ?? ''}</Td>
                    <Td className="whitespace-nowrap">
                      <Button size="sm" variant="outline" onClick={() => a.reviewLeave.mutate({ id: l.id, decision: 'reject' })}>
                        Reject
                      </Button>{' '}
                      <Button size="sm" onClick={() => a.reviewLeave.mutate({ id: l.id, decision: 'approve' })}>
                        Approve
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      ) : null}
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setAsking(true)}>
          Request leave
        </Button>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Type</Th>
            <Th>Dates</Th>
            <Th>Status</Th>
            <Th>Note</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {(mine.data ?? []).map((l) => (
            <Tr key={l.id}>
              <Td>{typeName.get(l.leaveTypeId) ?? 'Leave'}</Td>
              <Td className="text-xs">
                {formatDate(l.startDate, 'UTC')}
                {l.endDate !== l.startDate ? ` – ${formatDate(l.endDate, 'UTC')}` : ''}
                {l.isHalfDay ? ' (half day)' : ''}
              </Td>
              <Td>
                <Badge tone={LEAVE_TONE[l.status]}>{l.status}</Badge>
              </Td>
              <Td className="text-xs text-muted-foreground">{l.reviewNote ?? l.reason ?? ''}</Td>
              <Td>
                {l.status === 'pending' || (l.status === 'approved' && l.startDate > todayLocal()) ? (
                  <Button variant="link" size="sm" onClick={() => a.cancelLeave.mutate(l.id)}>
                    Cancel
                  </Button>
                ) : null}
              </Td>
            </Tr>
          ))}
          {mine.data?.length === 0 ? (
            <tr>
              <Td colSpan={5} className="text-center text-muted-foreground">
                No leave requests yet.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
      {asking ? <LeaveDialog onClose={() => setAsking(false)} /> : null}
    </div>
  );
}

function LeaveDialog({ onClose }: { onClose: () => void }) {
  const types = useLeaveTypes();
  const { requestLeave } = useAttendanceActions();
  const [typeId, setTypeId] = useState('');
  const [start, setStart] = useState(todayLocal(1));
  const [end, setEnd] = useState(todayLocal(1));
  const [half, setHalf] = useState(false);
  const [reason, setReason] = useState('');
  const err = (f: string) => (requestLeave.error instanceof ApiError ? requestLeave.error.fieldError(f) : undefined);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Request leave">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await requestLeave.mutateAsync({ leaveTypeId: typeId, startDate: start, endDate: half ? start : end, isHalfDay: half, ...(reason.trim() ? { reason: reason.trim() } : {}) }).catch(() => null);
            if (ok) onClose();
          }}
        >
          <Field label="Type *" error={err('leaveTypeId')}>
            <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">Choose…</option>
              {types.data
                ?.filter((t) => t.isActive)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.annualDays ? ` (${t.annualDays} days a year)` : ''}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" error={err('startDate')}>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="To" error={err('endDate')}>
              <Input type="date" value={half ? start : end} disabled={half} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={half} onChange={(e) => setHalf(e.target.checked)} /> Half day
          </label>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {requestLeave.error && !(requestLeave.error instanceof ApiError && requestLeave.error.status === 400) ? <Alert>{errorMessage(requestLeave.error)}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!typeId || requestLeave.isPending}>
              Send request
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- team records and corrections
function TeamRecords() {
  const people = useColleagues();
  const names = byId(people.data);
  const [from, setFrom] = useState(todayLocal(-6));
  const [to, setTo] = useState(todayLocal());
  const [userId, setUserId] = useState('');
  const [status, setStatus] = useState<DayStatus | ''>('');
  const records = useRecords({ from, to, ...(userId ? { userId } : {}), ...(status ? { status } : {}) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" className="h-8 w-auto text-xs" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <Input type="date" className="h-8 w-auto text-xs" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <Select className="h-8 w-auto text-xs" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Employee">
          <option value="">Everyone I can see</option>
          {people.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </Select>
        <Select className="h-8 w-auto text-xs" value={status} onChange={(e) => setStatus(e.target.value as DayStatus | '')} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(DAY_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      {records.error ? <Alert>{errorMessage(records.error)}</Alert> : null}
      <Table>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Employee</Th>
            <Th>Status</Th>
            <Th>In</Th>
            <Th>Out</Th>
            <Th>Photos</Th>
          </tr>
        </thead>
        <tbody>
          {(records.data ?? []).map((r) => (
            <Tr key={r.id}>
              <Td className="text-xs">{formatDate(r.workDate, 'UTC')}</Td>
              <Td>{names.get(r.userId)?.fullName ?? '—'}</Td>
              <Td>
                <Badge tone={DAY_STATUS_TONE[r.status]}>{DAY_STATUS_LABEL[r.status]}</Badge>
                {r.isCorrected ? <span className="ml-1 text-xs text-muted-foreground">corrected</span> : null}
              </Td>
              <Td className="text-xs">{r.checkInAt ? formatTime(r.checkInAt) : '—'}</Td>
              <Td className="text-xs">{r.checkOutAt ? formatTime(r.checkOutAt) : '—'}</Td>
              <Td className="whitespace-nowrap">
                {r.checkInPhotoFileId ? (
                  <Button variant="ghost" size="sm" onClick={() => void openDownload(r.checkInPhotoFileId!)}>
                    <Download /> In
                  </Button>
                ) : null}
                {r.checkOutPhotoFileId ? (
                  <Button variant="ghost" size="sm" onClick={() => void openDownload(r.checkOutPhotoFileId!)}>
                    <Download /> Out
                  </Button>
                ) : null}
              </Td>
            </Tr>
          ))}
          {records.data?.length === 0 ? (
            <tr>
              <Td colSpan={6} className="text-center text-muted-foreground">
                No records for these filters.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </div>
  );
}

function Corrections() {
  const corrections = useCorrections(true);
  const me = useMe();
  const a = useAttendanceActions();
  return (
    <div className="space-y-3">
      {a.reviewCorrection.error ? <Alert>{errorMessage(a.reviewCorrection.error)}</Alert> : null}
      <Table>
        <thead>
          <tr>
            <Th>Was</Th>
            <Th>Asked</Th>
            <Th>Reason</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {(corrections.data ?? []).map((c) => {
            const was = c.originalValues as { status?: DayStatus; checkInAt?: string | null; checkOutAt?: string | null } | undefined;
            return (
              <Tr key={c.id}>
                <Td className="text-xs">
                  {was?.status ? DAY_STATUS_LABEL[was.status] : '—'}
                  {was?.checkInAt ? ` · in ${formatTime(was.checkInAt)}` : ''}
                </Td>
                <Td className="text-xs">
                  {DAY_STATUS_LABEL[c.requestedStatus]}
                  {c.requestedCheckInAt ? ` · in ${formatTime(c.requestedCheckInAt)}` : ''}
                  {c.requestedCheckOutAt ? ` · out ${formatTime(c.requestedCheckOutAt)}` : ''}
                </Td>
                <Td className="text-xs text-muted-foreground">{c.reason}</Td>
                <Td className="whitespace-nowrap">
                  <Button size="sm" variant="outline" onClick={() => a.reviewCorrection.mutate({ id: c.id, decision: 'reject' })}>
                    Reject
                  </Button>{' '}
                  <Button size="sm" onClick={() => a.reviewCorrection.mutate({ id: c.id, decision: 'approve' })}>
                    Approve
                  </Button>
                </Td>
              </Tr>
            );
          })}
          {corrections.data?.length === 0 ? (
            <tr>
              <Td colSpan={4} className="text-center text-muted-foreground">
                No corrections waiting{me.data ? '' : ''}.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </div>
  );
}
