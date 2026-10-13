'use client';

import { Alert, Button, Dialog, DialogContent, Field, Select } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useState } from 'react';
import { errorMessage } from '@/core/api';
import { useReasons, useStages, useUsers } from '@/core/lookups';
import { useCan } from '@/core/session';
import { useBulkLeads } from './leads-api';

type Action = Schemas['BulkLeadAction']['action'];

/** Bulk actions on selected leads (SRS §1.4): assign, change stage, delete, restore. */
export function BulkBar({ ids, deletedTab, onDone }: { ids: string[]; deletedTab: boolean; onDone: () => void }) {
  const can = useCan();
  const bulk = useBulkLeads();
  const [action, setAction] = useState<Action | null>(null);
  const [result, setResult] = useState<Schemas['BulkResult'] | null>(null);

  async function run(body: Omit<Schemas['BulkLeadAction'], 'leadIds'>) {
    const r = await bulk.mutateAsync({ ...body, leadIds: ids }).catch(() => null);
    if (r) {
      setResult(r);
      setAction(null);
      if (!r.failed.length) onDone();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md bg-info/10 px-3 py-2 text-sm">
      <span className="font-medium">{ids.length} selected</span>
      {deletedTab ? (
        can('leads.delete') && (
          <Button variant="link" size="sm" onClick={() => void run({ action: 'restore' })}>
            Restore
          </Button>
        )
      ) : (
        <>
          {can('leads.assign') ? (
            <Button variant="link" size="sm" onClick={() => setAction('assign')}>
              Assign
            </Button>
          ) : null}
          {can('leads.edit') ? (
            <Button variant="link" size="sm" onClick={() => setAction('stage')}>
              Change stage
            </Button>
          ) : null}
          {can('leads.delete') ? (
            <Button variant="link" size="sm" className="text-danger" onClick={() => setAction('delete')}>
              Delete
            </Button>
          ) : null}
        </>
      )}
      {result?.failed.length ? (
        <span className="text-danger">
          {result.succeeded.length} done, {result.failed.length} failed: {result.failed[0]?.message}
        </span>
      ) : null}
      {bulk.error ? <span className="text-danger">{errorMessage(bulk.error)}</span> : null}

      <BulkDialog action={action} count={ids.length} busy={bulk.isPending} onClose={() => setAction(null)} onRun={run} />
    </div>
  );
}

function BulkDialog({
  action,
  count,
  busy,
  onClose,
  onRun,
}: {
  action: Action | null;
  count: number;
  busy: boolean;
  onClose: () => void;
  onRun: (body: Omit<Schemas['BulkLeadAction'], 'leadIds'>) => void;
}) {
  const users = useUsers();
  const stages = useStages();
  const [toUserId, setToUserId] = useState('');
  const [stageId, setStageId] = useState('');
  const [reasonId, setReasonId] = useState('');
  const stage = stages.data?.find((s) => s.id === stageId);
  // SRS §2.21: a reason is required for Lost, Invalid and reassignment.
  const reasonType = action === 'assign' ? 'reassignment' : stage?.category === 'lost' ? 'lost' : stage?.category === 'invalid' ? 'invalid' : undefined;
  const reasons = useReasons(reasonType);
  const needsReason = !!reasonType;

  const title = action === 'assign' ? `Assign ${count} leads` : action === 'stage' ? `Change stage of ${count} leads` : `Delete ${count} leads`;
  const ready = action === 'delete' || (action === 'assign' ? !!toUserId : !!stageId) && (!needsReason || !!reasonId);

  return (
    <Dialog open={!!action} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={title}>
        <div className="space-y-3">
          {action === 'assign' ? (
            <Field label="Assign to">
              <Select value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
                <option value="">Choose an agent</option>
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
          {action === 'stage' ? (
            <Field label="New stage">
              <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
                <option value="">Choose a stage</option>
                {stages.data
                  ?.filter((s) => s.isActive !== false)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : null}
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
          {action === 'delete' ? <Alert tone="warning">Deleted leads move to the Deleted tab and can be restored.</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant={action === 'delete' ? 'danger' : 'primary'}
              disabled={!ready || busy}
              onClick={() =>
                action &&
                onRun({ action, ...(toUserId ? { toUserId } : {}), ...(stageId ? { stageId } : {}), ...(reasonId ? { reasonId } : {}) })
              }
            >
              {busy ? 'Working…' : 'Apply'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
