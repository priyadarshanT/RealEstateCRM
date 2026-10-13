'use client';

import { Alert, Button, Dialog, DialogContent, Field, Input, Select, Textarea, cn } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useState } from 'react';
import { errorMessage } from '@/core/api';
import { isoToLocalInput, localInputToIso } from '@/core/format';
import { useReasons, useStages } from '@/core/lookups';
import { useLeadMutations, type Lead } from './leads-api';

/**
 * Stage bar (wireframe "Lead page"). Lost and Invalid need a reason (SRS §2.21);
 * an open stage asks for the next follow-up date (§2.20).
 */
export function StageBar({ lead, canEdit }: { lead: Lead; canEdit: boolean }) {
  const stages = useStages();
  const { changeStage } = useLeadMutations(lead.id);
  const [target, setTarget] = useState<Schemas['LeadStage'] | null>(null);
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const reasonType = target?.category === 'lost' ? 'lost' : target?.category === 'invalid' ? 'invalid' : undefined;
  const reasons = useReasons(reasonType);

  const open = (s: Schemas['LeadStage']) => {
    setTarget(s);
    setReasonId('');
    setNote('');
    setNext(lead.nextFollowUpAt ? isoToLocalInput(lead.nextFollowUpAt) : isoToLocalInput(new Date(Date.now() + 86_400_000).toISOString()));
    changeStage.reset();
  };

  async function save() {
    if (!target) return;
    const ok = await changeStage
      .mutateAsync({
        stageId: target.id,
        ...(reasonId ? { reasonId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(target.category === 'open' && next ? { nextFollowUpAt: localInputToIso(next) } : {}),
      })
      .catch(() => null);
    if (ok) setTarget(null);
  }

  return (
    <>
      <div className="flex flex-wrap gap-1">
        {stages.data
          ?.filter((s) => s.isActive !== false)
          .map((s) => {
            const current = s.id === lead.stageId;
            return (
              <button
                key={s.id}
                type="button"
                disabled={!canEdit || current}
                onClick={() => open(s)}
                className={cn(
                  'rounded px-2 py-1 text-xs',
                  current ? 'bg-primary font-semibold text-primary-foreground' : 'bg-primary/10 text-foreground enabled:hover:bg-primary/20',
                  (s.category === 'lost' || s.category === 'invalid') && !current && 'bg-muted text-muted-foreground',
                  !canEdit && !current && 'opacity-70',
                )}
              >
                {s.name}
              </button>
            );
          })}
      </div>

      <Dialog open={!!target} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogContent title={`Move to ${target?.name ?? ''}`}>
          <div className="space-y-3">
            {reasonType ? (
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
            {target?.category === 'open' ? (
              <Field label="Next follow-up">
                <Input type="datetime-local" value={next} onChange={(e) => setNext(e.target.value)} />
              </Field>
            ) : null}
            <Field label="Note">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {changeStage.error ? <Alert>{errorMessage(changeStage.error)}</Alert> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTarget(null)}>
                Cancel
              </Button>
              <Button disabled={(!!reasonType && !reasonId) || changeStage.isPending} onClick={save}>
                {changeStage.isPending ? 'Saving…' : 'Change stage'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
