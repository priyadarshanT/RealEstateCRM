'use client';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Table, Td, Tr } from '@crm/ui';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/core/api';
import { formatDate } from '@/core/format';
import { Policy, useAttendanceActions, useDefaultPolicy, useHolidays, useLeaveTypes } from './attendance-api';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Office hours, grace time, weekends, location, holidays and leave types (SRS §9.3); settings.manage only. */
export function AttendanceSetup() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <PolicyCard />
      <div className="space-y-3">
        <HolidaysCard />
        <LeaveTypesCard />
      </div>
    </div>
  );
}

function PolicyCard() {
  const policy = useDefaultPolicy();
  const { savePolicy } = useAttendanceActions();
  const current = policy.data?.default;
  const [p, setP] = useState<Partial<Policy>>({ name: 'Office hours', workStart: '09:00', workEnd: '18:00', graceMinutes: 10, halfDayMaxMinutes: 300, weekendDays: [0, 6], locationRequired: false });
  useEffect(() => {
    if (current) setP(current);
  }, [current?.id]);
  const set = (patch: Partial<Policy>) => setP((x) => ({ ...x, ...patch }));
  const toggleDay = (d: number) => set({ weekendDays: p.weekendDays?.includes(d) ? p.weekendDays.filter((x) => x !== d) : [...(p.weekendDays ?? []), d] });
  return (
    <Card>
      <CardHeader title="Office hours and rules" />
      <CardBody className="space-y-3 text-sm">
        {!current ? <Alert tone="info">No policy saved yet: 09:00–18:00 with 10 minutes grace is used.</Alert> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <Input type="time" value={p.workStart ?? ''} onChange={(e) => set({ workStart: e.target.value })} />
          </Field>
          <Field label="End">
            <Input type="time" value={p.workEnd ?? ''} onChange={(e) => set({ workEnd: e.target.value })} />
          </Field>
          <Field label="Grace (minutes, then Late)">
            <Input type="number" min={0} value={p.graceMinutes ?? 0} onChange={(e) => set({ graceMinutes: Number(e.target.value) })} />
          </Field>
          <Field label="Half day if worked at most (minutes)">
            <Input type="number" min={1} value={p.halfDayMaxMinutes ?? 300} onChange={(e) => set({ halfDayMaxMinutes: Number(e.target.value) })} />
          </Field>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Weekend</p>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1">
                <input type="checkbox" checked={!!p.weekendDays?.includes(i)} onChange={() => toggleDay(i)} /> {d}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!p.locationRequired} onChange={(e) => set({ locationRequired: e.target.checked })} /> Record location at check-in (users must allow it)
        </label>
        {p.locationRequired ? (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Office latitude">
              <Input value={p.officeLatitude ?? ''} onChange={(e) => set({ officeLatitude: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            <Field label="Office longitude">
              <Input value={p.officeLongitude ?? ''} onChange={(e) => set({ officeLongitude: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            <Field label="Radius (m)">
              <Input value={p.officeRadiusM ?? ''} onChange={(e) => set({ officeRadiusM: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
          </div>
        ) : null}
        {savePolicy.error ? <Alert>{errorMessage(savePolicy.error)}</Alert> : null}
        {savePolicy.isSuccess ? <Alert tone="success">Saved.</Alert> : null}
        <div className="flex justify-end">
          <Button
            disabled={savePolicy.isPending}
            onClick={() =>
              savePolicy.mutate({
                ...(current ? { id: current.id } : { name: 'Office hours', isDefault: true }),
                workStart: p.workStart,
                workEnd: p.workEnd,
                graceMinutes: p.graceMinutes,
                halfDayMaxMinutes: p.halfDayMaxMinutes,
                weekendDays: p.weekendDays,
                locationRequired: !!p.locationRequired,
                officeLatitude: p.locationRequired ? (p.officeLatitude ?? null) : null,
                officeLongitude: p.locationRequired ? (p.officeLongitude ?? null) : null,
                officeRadiusM: p.locationRequired ? (p.officeRadiusM ?? null) : null,
              })
            }
          >
            Save
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function HolidaysCard() {
  const holidays = useHolidays();
  const { addHoliday, removeHoliday } = useAttendanceActions();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  return (
    <Card>
      <CardHeader title="Holidays" />
      <CardBody className="space-y-2">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await addHoliday.mutateAsync({ holidayDate: date, name: name.trim() }).catch(() => null)) {
              setDate('');
              setName('');
            }
          }}
        >
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="UAE National Day" />
          </Field>
          <Button type="submit" size="sm" disabled={!date || !name.trim() || addHoliday.isPending}>
            Add
          </Button>
        </form>
        {addHoliday.error ? <Alert>{errorMessage(addHoliday.error)}</Alert> : null}
        <Table>
          <tbody>
            {(holidays.data ?? []).map((h) => (
              <Tr key={h.id}>
                <Td className="text-xs">{formatDate(h.holidayDate, 'UTC')}</Td>
                <Td>{h.name}</Td>
                <Td>
                  <Button variant="ghost" size="icon" aria-label="Remove holiday" onClick={() => removeHoliday.mutate(h.id)}>
                    <Trash2 />
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </CardBody>
    </Card>
  );
}

function LeaveTypesCard() {
  const types = useLeaveTypes();
  const { saveLeaveType } = useAttendanceActions();
  const [name, setName] = useState('');
  const [days, setDays] = useState('');
  return (
    <Card>
      <CardHeader title="Leave types" />
      <CardBody className="space-y-2">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await saveLeaveType.mutateAsync({ name: name.trim(), ...(days ? { annualDays: days } : {}) }).catch(() => null)) {
              setName('');
              setDays('');
            }
          }}
        >
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sick" />
          </Field>
          <Field label="Days a year (empty = no limit)">
            <Input value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9.]/g, ''))} className="w-28" />
          </Field>
          <Button type="submit" size="sm" disabled={!name.trim() || saveLeaveType.isPending}>
            Add
          </Button>
        </form>
        {saveLeaveType.error ? <Alert>{errorMessage(saveLeaveType.error)}</Alert> : null}
        <Table>
          <tbody>
            {(types.data ?? []).map((t) => (
              <Tr key={t.id}>
                <Td>{t.name}</Td>
                <Td className="text-xs">{t.annualDays ? `${t.annualDays} days a year` : 'No limit'}</Td>
                <Td className="text-xs">{t.isActive ? 'Active' : 'Off'}</Td>
                <Td>
                  <Button variant="link" size="sm" onClick={() => saveLeaveType.mutate({ id: t.id, isActive: !t.isActive })}>
                    {t.isActive ? 'Switch off' : 'Switch on'}
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </CardBody>
    </Card>
  );
}
