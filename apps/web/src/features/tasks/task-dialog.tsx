'use client';

import { Alert, Button, Dialog, DialogContent, Field, Input, Select, Textarea } from '@crm/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '@/core/api';
import { isoToLocalInput, localInputToIso } from '@/core/format';
import { useUsers } from '@/core/lookups';
import { useCan, useMe } from '@/core/session';
import { TASK_TYPE_LABEL, useTaskMutations, type Task } from './tasks-api';

const REMINDERS = [0, 5, 15, 30, 60, 1440];

/** Create or edit a call, follow-up, meeting, viewing or personal task (SRS §3.1–3.2). */
export function TaskDialog({
  open,
  onOpenChange,
  leadId,
  leadName,
  task,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId?: string;
  leadName?: string;
  task?: Task;
}) {
  const me = useMe();
  const can = useCan();
  const users = useUsers();
  const { create, update } = useTaskMutations();
  const mutation = task ? update : create;

  const defaultDue = () => isoToLocalInput(new Date(Date.now() + 60 * 60_000).toISOString());
  const [type, setType] = useState<Task['type']>(task?.type ?? 'call');
  const [title, setTitle] = useState(task?.title ?? '');
  const [due, setDue] = useState(task ? isoToLocalInput(task.dueAt) : defaultDue());
  const [reminder, setReminder] = useState(String(task?.reminderMinutes ?? 15));
  const [duration, setDuration] = useState(String(task?.durationMinutes ?? ''));
  const [assignee, setAssignee] = useState(task?.assignedUserId ?? '');
  const [description, setDescription] = useState(task?.description ?? '');

  useEffect(() => {
    if (!open) return;
    setType(task?.type ?? 'call');
    setTitle(task?.title ?? '');
    setDue(task ? isoToLocalInput(task.dueAt) : defaultDue());
    setReminder(String(task?.reminderMinutes ?? 15));
    setDuration(String(task?.durationMinutes ?? ''));
    setAssignee(task?.assignedUserId ?? me.data?.user.id ?? '');
    setDescription(task?.description ?? '');
    mutation.reset();
  }, [open, task?.id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      type,
      title: title.trim() || `${TASK_TYPE_LABEL[type]}${leadName ? ` · ${leadName}` : ''}`,
      dueAt: localInputToIso(due),
      assignedUserId: assignee || me.data!.user.id,
      reminderMinutes: Number(reminder),
      ...(duration ? { durationMinutes: Number(duration) } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(!task && leadId ? { leadId } : {}),
    };
    const ok = task ? await update.mutateAsync({ id: task.id, ...body }).catch(() => null) : await create.mutateAsync(body).catch(() => null);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={task ? 'Edit task' : leadName ? `Schedule · ${leadName}` : 'New task'}>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as Task['type'])}>
              {(Object.keys(TASK_TYPE_LABEL) as Task['type'][]).map((t) => (
                <option key={t} value={t}>
                  {TASK_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="When">
            <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} required />
          </Field>
          <Field label="Title" className="sm:col-span-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${TASK_TYPE_LABEL[type]}${leadName ? ` · ${leadName}` : ''}`} />
          </Field>
          <Field label="Reminder">
            <Select value={reminder} onChange={(e) => setReminder(e.target.value)}>
              {REMINDERS.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? 'No reminder' : m === 1440 ? '1 day before' : `${m} min before`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Duration (minutes)">
            <Input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))} placeholder="30" />
          </Field>
          {can('users.manage') ? (
            <Field label="Assigned to" className="sm:col-span-2">
              <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                {users.data
                  ?.filter((u) => u.status === 'active')
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Details" className="sm:col-span-2">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {mutation.error ? <Alert className="sm:col-span-2">{errorMessage(mutation.error)}</Alert> : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
