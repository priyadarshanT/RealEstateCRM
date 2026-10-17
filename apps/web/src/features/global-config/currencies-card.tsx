'use client';

import { Alert, Button, Card, CardBody, CardHeader, Input, Table, Td, Th, Tr } from '@crm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';

/** Enabled currencies and exchange rates to the base currency (SRS §11.5); amounts are never converted silently. */
export function CurrenciesCard() {
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
