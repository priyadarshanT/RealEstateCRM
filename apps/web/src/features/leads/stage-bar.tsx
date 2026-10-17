'use client';

import { Alert, Button, Dialog, DialogContent, Field, Input, Select, Textarea, cn } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useState } from 'react';
import { errorMessage } from '@/core/api';
import { isoToLocalInput, localInputToIso } from '@/core/format';
import { useStages, useSubstatuses } from '@/core/lookups';
import { TYPE_LABEL, useLeadMeetings, useMeetingActions, type MeetingType } from '@/features/calendar/calendar-api';
import { ScheduleDialog, type ScheduleInitial } from '@/features/calendar/schedule-dialog';
import { useClientPolicy } from '@/features/global-config/policy';
import { formatDateTime } from '@/core/format';
import { useLeadMutations, type Lead } from './leads-api';

/**
 * Status bar (stakeholder update 2026-10-17): Hot, Warm, Cold and Sale Done, each with its substatuses from
 * Global Configuration › Manage Status. Cold needs a substatus; Hot and Warm ask for the next follow-up, which is
 * required when the substatus needs scheduling and may not be in the past unless past dates are allowed.
 * Zoom Schedule and Viewing Schedule open the Schedule form for that date (§3.7); moving to Cold or Sale Done shows
 * the pending appointments and asks to keep or cancel them (§3.9).
 */
export function StageBar({ lead, canEdit }: { lead: Lead; canEdit: boolean }) {
  const stages = useStages();
  const substatuses = useSubstatuses();
  const policy = useClientPolicy();
  const { changeStage } = useLeadMutations(lead.id);
  const [target, setTarget] = useState<Schemas['LeadStage'] | null>(null);
  const [substatusId, setSubstatusId] = useState('');
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [pendingChoice, setPendingChoice] = useState<'keep' | 'cancel'>('keep');
  const [schedule, setSchedule] = useState<ScheduleInitial | null>(null);
  const meetings = useLeadMeetings(lead.id);
  const { cancel } = useMeetingActions();
  const pending = (meetings.data ?? []).filter((m) => m.status === 'scheduled');

  const options = (substatuses.data ?? []).filter((x) => x.stageId === target?.id && (x.isActive || x.id === lead.substatusId));
  const chosen = options.find((x) => x.id === substatusId);
  const open = target?.category === 'open';
  const needsSub = !!target && target.category !== 'open' && target.category !== 'won';
  const needsDate = open && (!!chosen?.requiresScheduling || !lead.nextFollowUpAt);
  const minDate = policy.data?.pastDateSelection ? undefined : isoToLocalInput(new Date().toISOString());
  const dateChanged = !lead.nextFollowUpAt || next !== isoToLocalInput(lead.nextFollowUpAt);
  const current = lead.substatusId ? substatuses.data?.find((x) => x.id === lead.substatusId) : undefined;

  const choose = (s: Schemas['LeadStage']) => {
    setTarget(s);
    setSubstatusId(s.id === lead.stageId ? (lead.substatusId ?? '') : '');
    setNote('');
    setNext(lead.nextFollowUpAt ? isoToLocalInput(lead.nextFollowUpAt) : isoToLocalInput(new Date(Date.now() + 86_400_000).toISOString()));
    setPendingChoice('keep');
    changeStage.reset();
    cancel.reset();
  };

  async function save() {
    if (!target) return;
    // Closing the lead: cancel its pending appointments first when the user chose to (never silently).
    if (!open && pendingChoice === 'cancel') {
      for (const m of pending) {
        const done = await cancel.mutateAsync({ id: m.id, reason: `Lead moved to ${target.name}` }).catch(() => null);
        if (!done) return;
      }
    }
    const ok = await changeStage
      .mutateAsync({
        stageId: target.id,
        ...(substatusId ? { substatusId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(open && next && (dateChanged || chosen?.requiresScheduling) ? { nextFollowUpAt: localInputToIso(next) } : {}),
      })
      .catch(() => null);
    if (ok) {
      setTarget(null);
      // Zoom Schedule / Viewing Schedule: book the appointment for the chosen date (§3.7).
      const kind: MeetingType | null = /zoom/i.test(chosen?.name ?? '') ? 'meeting' : /viewing/i.test(chosen?.name ?? '') ? 'viewing' : null;
      if (kind && open) setSchedule({ type: kind, startsAt: next ? localInputToIso(next) : undefined });
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {stages.data
          ?.filter((s) => s.isActive !== false)
          .map((s) => {
            const isCurrent = s.id === lead.stageId;
            return (
              <button
                key={s.id}
                type="button"
                disabled={!canEdit}
                onClick={() => choose(s)}
                title={isCurrent ? 'Change the substatus' : `Move to ${s.name}`}
                className={cn('rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors', !canEdit && 'opacity-70', isCurrent ? 'text-white' : 'enabled:hover:opacity-80')}
                style={isCurrent ? { background: s.color, boxShadow: `inset 0 0 0 1px ${s.color}` } : { color: s.color, background: `${s.color}12`, boxShadow: `inset 0 0 0 1px ${s.color}40` }}
              >
                {s.name}
                {isCurrent && current ? <span className="font-normal opacity-90"> · {current.name}</span> : null}
              </button>
            );
          })}
      </div>

      <Dialog open={!!target} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogContent title={target?.id === lead.stageId ? `${target?.name}: change substatus` : `Move to ${target?.name ?? ''}`}>
          <div className="space-y-3">
            {options.length ? (
              <Field label={needsSub ? 'Substatus *' : 'Substatus'}>
                <Select value={substatusId} onChange={(e) => setSubstatusId(e.target.value)}>
                  <option value="">{needsSub ? 'Choose a substatus' : 'None'}</option>
                  {options.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.requiresScheduling ? ' (needs a date)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {open ? (
              <Field label={needsDate ? 'Next follow-up *' : 'Next follow-up'}>
                <Input type="datetime-local" min={minDate} value={next} onChange={(e) => setNext(e.target.value)} />
              </Field>
            ) : null}
            {!open && target && pending.length ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                <p className="font-medium">This lead has {pending.length} pending appointment{pending.length > 1 ? 's' : ''}:</p>
                <ul className="my-1.5 list-disc pl-5 text-xs">
                  {pending.map((m) => (
                    <li key={m.id}>
                      {TYPE_LABEL[m.type]} · {formatDateTime(m.startsAt)}
                    </li>
                  ))}
                </ul>
                <label className="mr-4 inline-flex items-center gap-1.5">
                  <input type="radio" checked={pendingChoice === 'keep'} onChange={() => setPendingChoice('keep')} /> Keep them
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" checked={pendingChoice === 'cancel'} onChange={() => setPendingChoice('cancel')} /> Cancel them
                </label>
              </div>
            ) : null}
            <Field label="Note">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {changeStage.error || cancel.error ? <Alert>{errorMessage(changeStage.error ?? cancel.error)}</Alert> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTarget(null)}>
                Cancel
              </Button>
              <Button disabled={(needsSub && !substatusId) || (needsDate && !next) || changeStage.isPending || cancel.isPending} onClick={save}>
                {changeStage.isPending ? 'Saving…' : 'Save status'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ScheduleDialog open={!!schedule} initial={schedule ?? undefined} leadId={lead.id} leadName={lead.fullName} onClose={() => setSchedule(null)} />
    </>
  );
}
