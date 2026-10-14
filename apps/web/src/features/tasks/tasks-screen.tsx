'use client';

import { Alert, Badge, Button, Loading, Select, Table, Td, Th, Tr, cn } from '@crm/ui';
import { CalendarClock, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { errorMessage } from '@/core/api';
import { formatDateTime } from '@/core/format';
import { byId, useUsers } from '@/core/lookups';
import { useCan, useMe } from '@/core/session';
import { apiDateRange, rangeFor, sameDay, shift, type CalendarView } from './calendar-range';
import { TaskChip } from './task-chip';
import { TaskDetailDialog } from './task-detail-dialog';
import { BookingPageEditor } from '@/features/calendar/booking-page-editor';
import { TaskDialog } from './task-dialog';
import { TASK_TYPE_LABEL, useTasks, type Task } from './tasks-api';

const VIEWS: { key: CalendarView; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'list', label: 'List' },
];

/** Day, week, month and list views of calls, meetings, viewings and tasks (SRS §3.1). */
export function TasksScreen() {
  const me = useMe();
  const can = useCan();
  const users = useUsers();
  const userById = byId(users.data);
  const tz = me.data?.user.timezone;
  const [view, setView] = useState<CalendarView>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [whose, setWhose] = useState<string>('mine');
  const [type, setType] = useState<Task['type'] | ''>('');
  const [creating, setCreating] = useState(false);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [bookingPage, setBookingPage] = useState(false);

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const assignedUserId = whose === 'mine' ? me.data?.user.id : whose === 'all' ? undefined : whose;
  const tasks = useTasks({
    view,
    ...apiDateRange(range.from, range.to),
    ...(assignedUserId ? { assignedUserId } : {}),
    ...(type ? { type } : {}),
  });
  const overdue = useTasks({ overdue: true, status: 'open', ...(assignedUserId ? { assignedUserId } : {}) });
  // Keep only tasks inside the local range (the API range has an extra day on each side).
  const list = (tasks.data?.data ?? [])
    .filter((t) => {
      const due = Date.parse(t.dueAt);
      return due >= range.from.getTime() && due < range.to.getTime();
    })
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const today = new Date();

  const title =
    view === 'month'
      ? anchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      : view === 'day'
        ? anchor.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
        : `${range.from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(range.to.getTime() - 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Tasks & Calendar</h1>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-border bg-surface">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={cn('px-3 py-1.5 text-sm', view === v.key ? 'bg-primary font-semibold text-primary-foreground' : 'hover:bg-muted')}
            >
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
        <span className="text-sm font-medium">{title}</span>
        <Select className="h-8 w-auto text-xs" value={whose} onChange={(e) => setWhose(e.target.value)} aria-label="Whose tasks">
          <option value="mine">My tasks</option>
          {can('users.manage') ? (
            <>
              <option value="all">Everyone I can see</option>
              {users.data
                ?.filter((u) => u.status === 'active' && u.id !== me.data?.user.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
            </>
          ) : (
            <option value="all">All my scope</option>
          )}
        </Select>
        <Select className="h-8 w-auto text-xs" value={type} onChange={(e) => setType(e.target.value as Task['type'] | '')} aria-label="Type">
          <option value="">All types</option>
          {(Object.keys(TASK_TYPE_LABEL) as Task['type'][]).map((t) => (
            <option key={t} value={t}>
              {TASK_TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <span className="ml-auto" />
        {overdue.data?.data.length ? <Badge tone="danger">{overdue.data.data.length} overdue</Badge> : null}
        <Button variant="outline" size="sm" onClick={() => setBookingPage(true)}>
          <CalendarClock /> My booking page
        </Button>
        {can('leads.edit') ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> New task
          </Button>
        ) : null}
      </div>

      {tasks.error ? <Alert>{errorMessage(tasks.error)}</Alert> : null}
      {tasks.isLoading ? <Loading /> : null}

      {view === 'list' ? (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Type</Th>
              <Th>Title</Th>
              <Th>Assigned to</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => {
              const late = t.status === 'open' && Date.parse(t.dueAt) < Date.now();
              return (
                <Tr key={t.id} className="cursor-pointer" onClick={() => setOpenTask(t)}>
                  <Td className={late ? 'font-medium text-danger' : undefined}>{formatDateTime(t.dueAt, tz)}</Td>
                  <Td>{TASK_TYPE_LABEL[t.type]}</Td>
                  <Td>{t.title}</Td>
                  <Td>{userById.get(t.assignedUserId)?.fullName ?? '—'}</Td>
                  <Td>
                    <Badge tone={t.status === 'completed' ? 'success' : late ? 'danger' : t.status === 'cancelled' ? 'neutral' : 'primary'}>
                      {t.status === 'open' ? (late ? 'Overdue' : 'Due') : t.status === 'completed' ? 'Done' : 'Cancelled'}
                    </Badge>
                  </Td>
                </Tr>
              );
            })}
            {list.length === 0 && !tasks.isLoading ? (
              <tr>
                <Td colSpan={5} className="text-center text-muted-foreground">
                  Nothing planned in the next 30 days.
                </Td>
              </tr>
            ) : null}
          </tbody>
        </Table>
      ) : (
        <div className={cn('grid gap-2', view === 'day' ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7')}>
          {range.days.map((d) => {
            const inMonth = view !== 'month' || d.getMonth() === anchor.getMonth();
            const items = list.filter((t) => sameDay(new Date(t.dueAt), d));
            return (
              <div
                key={d.toISOString()}
                className={cn('min-h-28 rounded-lg border border-border bg-surface p-2', !inMonth && 'opacity-50', sameDay(d, today) && 'border-primary')}
              >
                <p className="mb-1.5 border-b border-border pb-1 text-xs font-semibold">
                  {d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', ...(view === 'month' ? {} : { month: 'short' }) })}
                </p>
                <div className="space-y-1">
                  {items.map((t) => (
                    <TaskChip key={t.id} task={t} timeZone={tz} onClick={() => setOpenTask(t)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TaskDialog open={creating} onOpenChange={setCreating} />
      <TaskDetailDialog task={openTask} timeZone={tz} onClose={() => setOpenTask(null)} />
      <BookingPageEditor open={bookingPage} onClose={() => setBookingPage(false)} />
    </div>
  );
}
