'use client';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Loading } from '@crm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';

type Scoring = { budget_fit: number; project_match: number; source_quality: number; engagement: number };

const WEIGHTS: { key: keyof Scoring; label: string }[] = [
  { key: 'budget_fit', label: 'Budget fit' },
  { key: 'project_match', label: 'Project match' },
  { key: 'source_quality', label: 'Source quality' },
  { key: 'engagement', label: 'Engagement' },
];

/** Lead scoring weights (SRS §2.24), shown under Global Configuration › Leads. Response time is part of each rotation rule. */
export function LeadRules() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: async () => unwrap(await api.GET('/settings')).data });
  const value = (key: string) => settings.data?.find((s) => s.key === key)?.value as Record<string, unknown> | undefined;
  const put = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: Record<string, unknown> }) =>
      unwrap(await api.PUT('/settings/{key}', { params: { path: { key } }, body: { value } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const scoring = value('leads.scoring') as Scoring | undefined;
  const [weights, setWeights] = useState<Scoring>({ budget_fit: 30, project_match: 20, source_quality: 20, engagement: 30 });
  useEffect(() => {
    if (scoring) setWeights(scoring);
  }, [scoring?.budget_fit, scoring?.project_match, scoring?.source_quality, scoring?.engagement]);
  const total = WEIGHTS.reduce((s, w) => s + (weights[w.key] || 0), 0);

  if (settings.isLoading) return <Loading />;

  return (
    <div className="grid gap-3">
      <Card>
        <CardHeader title="Lead scoring weights" />
        <CardBody className="space-y-3">
          <p className="text-sm text-muted-foreground">Each lead scores 0–100. The weights must add up to 100.</p>
          <div className="grid grid-cols-2 gap-2">
            {WEIGHTS.map((w) => (
              <Field key={w.key} label={w.label}>
                <Input type="number" min={0} max={100} value={weights[w.key]} onChange={(e) => setWeights({ ...weights, [w.key]: Number(e.target.value) })} />
              </Field>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className={total === 100 ? 'text-sm text-muted-foreground' : 'text-sm font-medium text-danger'}>Total: {total} / 100</span>
            <Button disabled={total !== 100 || put.isPending} onClick={() => put.mutate({ key: 'leads.scoring', value: weights })}>
              Save weights
            </Button>
          </div>
        </CardBody>
      </Card>
      {put.error ? <Alert >{errorMessage(put.error)}</Alert> : null}
      {put.isSuccess ? <Alert tone="success" >Saved.</Alert> : null}
    </div>
  );
}
