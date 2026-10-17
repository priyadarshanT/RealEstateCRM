'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Field, Select, Textarea } from '@crm/ui';
import { CalendarPlus, ListTodo, Mail, MessageCircle, NotebookPen, Phone, Share2, UserCog } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/core/api';
import { byId, useColleagues, useReasons, useUsers } from '@/core/lookups';
import { useCan, useMe } from '@/core/session';
import { SendMessageDialog } from '@/features/messaging/send-message-dialog';
import { OutcomeForm } from '@/features/tasks/outcome-form';
import { ScheduleDialog } from '@/features/calendar/schedule-dialog';
import { TaskDialog } from '@/features/tasks/task-dialog';
import { useLeadMutations, useShares, type Lead } from './leads-api';

type Open = 'note' | 'call' | 'schedule' | 'task' | 'share' | 'assign' | 'whatsapp' | 'email' | null;

/** Lead page actions (SRS §2.14, §2.16–17, §5.1): note, call, WhatsApp, email, schedule, share, assign. */
export function LeadActions({ lead, canEdit }: { lead: Lead; canEdit: boolean }) {
  const can = useCan();
  const me = useMe();
  const [open, setOpen] = useState<Open>(null);
  const isOwnerOrManager = lead.access === 'owner' || lead.access === 'scope';
  const canShare = can('leads.share') && (isOwnerOrManager || lead.ownerUserId === me.data?.user.id);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canEdit ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen('note')}>
              <NotebookPen /> Add note
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOpen('call')}>
              <Phone /> Log call
            </Button>
            {can('messages.send') ? (
              <>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-600/90" onClick={() => setOpen('whatsapp')}>
                  <MessageCircle /> WhatsApp
                </Button>
                <Button variant="outline" size="sm" onClick={() => setOpen('email')}>
                  <Mail /> Email
                </Button>
              </>
            ) : null}
            {/* Lead page §3.1–3.4: Schedule only for Hot and Warm (open) leads. */}
            {lead.stageCategory === 'open' ? (
              <Button variant="outline" size="sm" onClick={() => setOpen('schedule')}>
                <CalendarPlus /> Schedule
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setOpen('task')}>
              <ListTodo /> Add task
            </Button>
          </>
        ) : null}
        {canShare ? (
          <Button variant="outline" size="sm" onClick={() => setOpen('share')}>
            <Share2 /> Share
          </Button>
        ) : null}
        {can('leads.assign') && isOwnerOrManager ? (
          <Button variant="outline" size="sm" onClick={() => setOpen('assign')}>
            <UserCog /> Assign
          </Button>
        ) : null}
      </div>

      <NoteDialog lead={lead} open={open === 'note'} onClose={() => setOpen(null)} />
      <CallDialog lead={lead} open={open === 'call'} onClose={() => setOpen(null)} />
      <TaskDialog open={open === 'task'} onOpenChange={(v) => setOpen(v ? 'task' : null)} leadId={lead.id} leadName={lead.fullName} />
      <ScheduleDialog open={open === 'schedule'} leadId={lead.id} leadName={lead.fullName} onClose={() => setOpen(null)} />
      <ShareDialog lead={lead} open={open === 'share'} onClose={() => setOpen(null)} />
      <AssignDialog lead={lead} open={open === 'assign'} onClose={() => setOpen(null)} />
      <SendMessageDialog
        leadId={lead.id}
        leadName={lead.fullName}
        channel={open === 'whatsapp' || open === 'email' ? open : null}
        address={open === 'whatsapp' ? lead.phonePrimary : lead.email}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

function NoteDialog({ lead, open, onClose }: { lead: Lead; open: boolean; onClose: () => void }) {
  const { addNote } = useLeadMutations(lead.id);
  const [body, setBody] = useState('');
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={`Note · ${lead.fullName}`}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await addNote.mutateAsync({ body: body.trim() }).catch(() => null)) {
              setBody('');
              onClose();
            }
          }}
        >
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Wants 2-bed, sea view, budget AED 3.2M" autoFocus />
          {addNote.error ? <Alert>{errorMessage(addNote.error)}</Alert> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={!body.trim() || addNote.isPending}>
              Save note
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CallDialog({ lead, open, onClose }: { lead: Lead; open: boolean; onClose: () => void }) {
  const { logCall } = useLeadMutations(lead.id);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={`Log call · ${lead.fullName}`}>
        <OutcomeForm
          busy={logCall.isPending}
          error={logCall.error}
          onSubmit={async (v) => {
            if (await logCall.mutateAsync(v).catch(() => null)) onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({ lead, open, onClose }: { lead: Lead; open: boolean; onClose: () => void }) {
  const colleagues = useColleagues();
  const shares = useShares(lead.id);
  const { share, unshare } = useLeadMutations(lead.id);
  const [userId, setUserId] = useState('');
  const [access, setAccess] = useState<'view' | 'edit'>('view');
  const sharedIds = new Set(shares.data?.map((s) => s.userId));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={`Share · ${lead.fullName}`}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            {(shares.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Not shared with anyone.</p> : null}
            {shares.data?.map((s) => (
              <div key={s.userId} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1.5 text-sm">
                <span>{s.userName ?? s.userId}</span>
                <span className="flex items-center gap-2">
                  <Badge tone="info">{s.access === 'edit' ? 'Can edit' : 'View only'}</Badge>
                  <Button variant="link" size="sm" className="text-danger" onClick={() => unshare.mutate(s.userId)}>
                    Remove
                  </Button>
                </span>
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <Field label="Share with">
              <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Choose a user</option>
                {colleagues.data
                  ?.filter((u) => u.id !== lead.ownerUserId && !sharedIds.has(u.id))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Access">
              <Select value={access} onChange={(e) => setAccess(e.target.value as 'view' | 'edit')}>
                <option value="view">View only</option>
                <option value="edit">Can edit</option>
              </Select>
            </Field>
            <Button
              disabled={!userId || share.isPending}
              onClick={async () => {
                if (await share.mutateAsync({ userId, access }).catch(() => null)) setUserId('');
              }}
            >
              Share
            </Button>
          </div>
          {share.error || unshare.error ? <Alert>{errorMessage(share.error ?? unshare.error)}</Alert> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ lead, open, onClose }: { lead: Lead; open: boolean; onClose: () => void }) {
  const colleagues = useColleagues();
  // Full user details (lead assignment on/off) only load for users.manage; the hint is shown when known.
  const details = byId(useUsers().data);
  const reasons = useReasons('reassignment');
  const { assign } = useLeadMutations(lead.id);
  const [toUserId, setToUserId] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');
  // SRS §2.21: reassignment (changing an existing owner) needs a reason.
  const needsReason = !!lead.ownerUserId;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={`Assign · ${lead.fullName}`}>
        <div className="space-y-3">
          <Field label="New owner">
            <Select value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
              <option value="">Choose an agent</option>
              {colleagues.data
                ?.filter((u) => u.id !== lead.ownerUserId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                    {details.get(u.id)?.receivesLeads === false ? ' (not receiving leads)' : ''}
                  </option>
                ))}
            </Select>
          </Field>
          {needsReason ? (
            <Field label="Reason *">
              <Select value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
                <option value="">Choose a reason</option>
                {reasons.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Note">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {assign.error ? <Alert>{errorMessage(assign.error)}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!toUserId || (needsReason && !reasonId) || assign.isPending}
              onClick={async () => {
                const ok = await assign
                  .mutateAsync({ toUserId, ...(reasonId ? { reasonId } : {}), ...(note.trim() ? { note: note.trim() } : {}) })
                  .catch(() => null);
                if (ok) onClose();
              }}
            >
              Assign
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
