'use client';

import { Alert, Badge, Button, Checkbox, Dialog, DialogContent, Field, Input, Loading, Table, Td, Th, Tr } from '@crm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { formatDate } from '@/core/format';

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * Meta check (SRS §8.7): compares the leads Meta has for a period with the leads in the CRM and recovers missing
 * ones. Runs also happen every night for the previous day.
 */
export function MetaCheckDialog({ integrationId, onClose }: { integrationId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState(day(-7));
  const [to, setTo] = useState(day(0));
  const [recover, setRecover] = useState(true);
  const runs = useQuery({
    queryKey: ['reconciliations', integrationId],
    enabled: !!integrationId,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'running') ? 3000 : false),
    queryFn: async () => unwrap(await api.GET('/reconciliations', { params: { query: { integrationId: integrationId!, limit: 20 } } })).data,
  });
  const run = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/integrations/{id}/reconciliations', {
          params: { path: { id: integrationId! } },
          // The "to" day is included: the period ends at the start of the next day (UTC).
          body: { periodStart: `${from}T00:00:00Z`, periodEnd: new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString(), recoverMissing: recover },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reconciliations'] }),
  });

  return (
    <Dialog open={!!integrationId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Meta check" wide>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">Compares the leads in Meta with the leads in the CRM. Missing leads can be imported again. A check of the previous day also runs every night.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="From">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <label className="flex h-9 items-center gap-2">
              <Checkbox checked={recover} onCheckedChange={(v) => setRecover(v === true)} /> Import missing leads
            </label>
            <Button disabled={run.isPending || !from || !to} onClick={() => run.mutate()}>
              Run check
            </Button>
          </div>
          {run.error ? <Alert>{errorMessage(run.error)}</Alert> : null}
          {runs.isLoading ? <Loading /> : null}
          <Table>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Status</Th>
                <Th>In Meta</Th>
                <Th>In CRM</Th>
                <Th>Missing</Th>
                <Th>Recovered</Th>
              </tr>
            </thead>
            <tbody>
              {(runs.data ?? []).map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap text-xs">
                    {formatDate(r.periodStart, 'UTC')} – {formatDate(new Date(Date.parse(r.periodEnd) - 1).toISOString(), 'UTC')}
                  </Td>
                  <Td>
                    <Badge tone={r.status === 'completed' ? 'success' : r.status === 'failed' ? 'danger' : 'neutral'}>{r.status}</Badge>
                  </Td>
                  <Td>{r.sourceCount ?? 0}</Td>
                  <Td>{r.crmCount ?? 0}</Td>
                  <Td className={r.missingExternalIds?.length ? 'font-medium text-danger' : undefined} title={r.missingExternalIds?.join(', ')}>
                    {r.missingExternalIds?.length ?? 0}
                  </Td>
                  <Td>{r.recoveredCount ?? 0}</Td>
                </Tr>
              ))}
              {runs.data?.length === 0 ? (
                <tr>
                  <Td colSpan={6} className="text-center text-muted-foreground">
                    No checks yet.
                  </Td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
