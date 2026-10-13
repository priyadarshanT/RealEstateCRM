'use client';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Loading, Table, Td, Th, Tr } from '@crm/ui';
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

/** Response time (10-minute rule, SRS §3.4), lead scoring weights (§2.24) and currencies (§11.5). */
export function RulesTab() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: async () => unwrap(await api.GET('/settings')).data });
  const value = (key: string) => settings.data?.find((s) => s.key === key)?.value as Record<string, unknown> | undefined;
  const put = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: Record<string, unknown> }) =>
      unwrap(await api.PUT('/settings/{key}', { params: { path: { key } }, body: { value } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const response = value('leads.response_time');
  const scoring = value('leads.scoring') as Scoring | undefined;
  const [minutes, setMinutes] = useState('10');
  const [weights, setWeights] = useState<Scoring>({ budget_fit: 30, project_match: 20, source_quality: 20, engagement: 30 });
  useEffect(() => {
    if (response?.minutes) setMinutes(String(response.minutes));
  }, [response?.minutes]);
  useEffect(() => {
    if (scoring) setWeights(scoring);
  }, [scoring?.budget_fit, scoring?.project_match, scoring?.source_quality, scoring?.engagement]);
  const total = WEIGHTS.reduce((s, w) => s + (weights[w.key] || 0), 0);

  if (settings.isLoading) return <Loading />;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader title="Response time" />
        <CardBody className="space-y-3">
          <p className="text-sm text-muted-foreground">
            An agent has this long to act on a new lead (call, note, message or stage change). Then it moves to the next agent in the same team; if the whole team misses it, the Admin
            decides.
          </p>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              put.mutate({ key: 'leads.response_time', value: { minutes: Number(minutes), next_agent_scope: 'team', fallback: 'admin' } });
            }}
          >
            <Field label="Minutes">
              <Input type="number" min={1} max={1440} className="w-28" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </Field>
            <Button type="submit" disabled={put.isPending || Number(minutes) === response?.minutes}>
              Save
            </Button>
          </form>
        </CardBody>
      </Card>

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
      {put.error ? <Alert className="lg:col-span-2">{errorMessage(put.error)}</Alert> : null}
      {put.isSuccess ? <Alert tone="success" className="lg:col-span-2">Saved.</Alert> : null}
      <CurrenciesCard />
    </div>
  );
}

function CurrenciesCard() {
  const qc = useQueryClient();
  const currencies = useQuery({ queryKey: ['currencies'], queryFn: async () => unwrap(await api.GET('/currencies')).data });
  const [rates, setRates] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const list = Object.entries(rates)
        .filter(([, r]) => r.trim())
        .map(([code, rateToBase]) => ({ code, rateToBase: rateToBase.trim(), effectiveDate: today }));
      return unwrap(await api.PUT('/currencies', { body: { currencies: list } }));
    },
    onSuccess: () => {
      setRates({});
      void qc.invalidateQueries({ queryKey: ['currencies'] });
    },
  });

  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Currencies and exchange rates" />
      <CardBody className="space-y-3">
        <Table>
          <thead>
            <tr>
              <Th>Currency</Th>
              <Th>Rate to company currency</Th>
              <Th>New rate (from today)</Th>
            </tr>
          </thead>
          <tbody>
            {(currencies.data ?? []).flatMap((c) => (c.code ? [{ ...c, code: c.code }] : [])).map((c) => (
              <Tr key={c.code}>
                <Td>
                  {c.code} · {c.name}
                </Td>
                <Td>{c.rateToBase ?? '—'}</Td>
                <Td>
                  <Input className="h-7 w-32 text-xs" inputMode="decimal" value={rates[c.code] ?? ''} onChange={(e) => setRates({ ...rates, [c.code]: e.target.value })} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {save.error ? <Alert>{errorMessage(save.error)}</Alert> : null}
        <div className="flex justify-end">
          <Button disabled={!Object.values(rates).some((r) => r.trim()) || save.isPending} onClick={() => save.mutate()}>
            Save rates
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
