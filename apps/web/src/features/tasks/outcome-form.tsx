'use client';

import { Alert, Button, Field, Input, Select, Textarea, cn } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/core/api';
import { isoToLocalInput, localInputToIso } from '@/core/format';
import { OUTCOMES, type Outcome } from './tasks-api';

type NextAction = NonNullable<Schemas['CallLog']['nextAction']>;

export interface OutcomeValue {
  outcome: Outcome;
  note?: string;
  nextAction?: NextAction;
}

/**
 * Call outcome and next action (SRS §3.2, wireframe "Log call"). Used when logging a call on a lead
 * and when completing a call task from the calendar.
 */
export function OutcomeForm({ onSubmit, busy, error, submitLabel = 'Save' }: { onSubmit: (v: OutcomeValue) => void; busy: boolean; error: unknown; submitLabel?: string }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState('');
  const [planNext, setPlanNext] = useState(true);
  const [nextType, setNextType] = useState<NextAction['type']>('call');
  const [nextDue, setNextDue] = useState(isoToLocalInput(new Date(Date.now() + 24 * 3_600_000).toISOString()));
  const [reminder, setReminder] = useState('15');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!outcome) return;
    onSubmit({
      outcome,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(planNext ? { nextAction: { type: nextType, dueAt: localInputToIso(nextDue), reminderMinutes: Number(reminder) } } : {}),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Outcome *</p>
        <div className="flex flex-wrap gap-1.5">
          {OUTCOMES.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setOutcome(o.key)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs',
                outcome === o.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted hover:bg-muted/70',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <Field label="Note">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Interested in 3-bed, call after 6 PM" />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={planNext} onChange={(e) => setPlanNext(e.target.checked)} /> Plan the next action
      </label>
      {planNext ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Next action">
            <Select value={nextType} onChange={(e) => setNextType(e.target.value as NextAction['type'])}>
              <option value="call">Call</option>
              <option value="follow_up">Follow-up</option>
              <option value="meeting">Meeting</option>
              <option value="viewing">Viewing</option>
            </Select>
          </Field>
          <Field label="When">
            <Input type="datetime-local" value={nextDue} onChange={(e) => setNextDue(e.target.value)} required />
          </Field>
          <Field label="Remind">
            <Select value={reminder} onChange={(e) => setReminder(e.target.value)}>
              <option value="0">No reminder</option>
              <option value="15">15 min before</option>
              <option value="30">30 min before</option>
              <option value="60">1 hour before</option>
            </Select>
          </Field>
        </div>
      ) : null}
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={!outcome || busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
