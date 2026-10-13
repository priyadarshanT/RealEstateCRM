'use client';

import { Alert, Badge, Button, Dialog, DialogContent } from '@crm/ui';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/core/api';
import { formatDateTime } from '@/core/format';
import { byId, useUsers } from '@/core/lookups';
import { OutcomeForm } from './outcome-form';
import { TaskDialog } from './task-dialog';
import { OUTCOMES, TASK_TYPE_LABEL, useTaskMutations, type Task } from './tasks-api';

/** Open a task: complete it (calls ask for the outcome and next action), edit, or cancel. */
export function TaskDetailDialog({ task, onClose, timeZone }: { task: Task | null; onClose: () => void; timeZone?: string }) {
  const users = byId(useUsers().data);
  const { complete, cancel } = useTaskMutations();
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);

  if (!task) return null;
  const isCall = task.type === 'call';
  const open = task.status === 'open';
  const overdue = open && Date.parse(task.dueAt) < Date.now();

  const close = () => {
    setCompleting(false);
    complete.reset();
    cancel.reset();
    onClose();
  };

  return (
    <>
      <Dialog open={!!task && !editing} onOpenChange={(v) => !v && close()}>
        <DialogContent title={`${TASK_TYPE_LABEL[task.type]} · ${task.title}`}>
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={task.status === 'completed' ? 'success' : overdue ? 'danger' : task.status === 'cancelled' ? 'neutral' : 'primary'}>
                {task.status === 'open' ? (overdue ? 'Overdue' : 'Due') : task.status === 'completed' ? 'Done' : 'Cancelled'}
              </Badge>
              <span>{formatDateTime(task.dueAt, timeZone)}</span>
              {task.durationMinutes ? <span className="text-muted-foreground">· {task.durationMinutes} min</span> : null}
            </div>
            <p>
              <span className="text-muted-foreground">Assigned to:</span> {users.get(task.assignedUserId)?.fullName ?? 'Me'}
            </p>
            {task.leadId ? (
              <p>
                <Link href={`/leads/${task.leadId}`} className="text-primary hover:underline" onClick={close}>
                  Open lead
                </Link>
              </p>
            ) : null}
            {task.description ? <p className="whitespace-pre-wrap">{task.description}</p> : null}
            {task.outcome ? (
              <p>
                <span className="text-muted-foreground">Outcome:</span> {OUTCOMES.find((o) => o.key === task.outcome)?.label}
                {task.outcomeNote ? ` — ${task.outcomeNote}` : ''}
              </p>
            ) : null}

            {open && completing ? (
              <div className="rounded-md border border-border p-3">
                <OutcomeForm
                  submitLabel="Complete"
                  busy={complete.isPending}
                  error={complete.error}
                  onSubmit={async (v) => {
                    const ok = await complete
                      .mutateAsync({ id: task.id, outcome: v.outcome, ...(v.note ? { outcomeNote: v.note } : {}), ...(v.nextAction ? { nextAction: v.nextAction } : {}) })
                      .catch(() => null);
                    if (ok) close();
                  }}
                />
              </div>
            ) : null}
            {cancel.error ? <Alert>{errorMessage(cancel.error)}</Alert> : null}
            {complete.error && !completing ? <Alert>{errorMessage(complete.error)}</Alert> : null}

            {open && !completing ? (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" disabled={cancel.isPending} onClick={async () => (await cancel.mutateAsync(task.id).catch(() => null)) && close()}>
                  Cancel task
                </Button>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                {isCall ? (
                  <Button onClick={() => setCompleting(true)}>Log call</Button>
                ) : (
                  <Button disabled={complete.isPending} onClick={async () => (await complete.mutateAsync({ id: task.id }).catch(() => null)) && close()}>
                    Mark done
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <TaskDialog
        open={editing}
        task={task}
        onOpenChange={(v) => {
          setEditing(v);
          if (!v) close();
        }}
      />
    </>
  );
}
