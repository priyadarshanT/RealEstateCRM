'use client';

import { Alert, Button, Card, CardBody, CardHeader, Input } from '@crm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';

type Format = { prefix: string; include_year: boolean; padding: number };
type Numbering = Record<'sales_invoice' | 'purchase_invoice' | 'purchase_order', Format>;

const DEFAULTS: Numbering = {
  sales_invoice: { prefix: 'INV-', include_year: true, padding: 4 },
  purchase_invoice: { prefix: 'PINV-', include_year: true, padding: 4 },
  purchase_order: { prefix: 'PO-', include_year: true, padding: 4 },
};
const LABEL: Record<keyof Numbering, string> = { sales_invoice: 'Sales invoices', purchase_invoice: 'Purchase invoices', purchase_order: 'Purchase orders' };

const example = (f: Format) => `${f.prefix}${f.include_year ? `${new Date().getFullYear()}-` : ''}${'1'.padStart(f.padding, '0')}`;

/** Invoice numbering (SRS §11.5, setting finance.numbering): prefix, year and digits per document type. */
export function NumberingCard() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: async () => unwrap(await api.GET('/settings')).data });
  const saved = settings.data?.find((s) => s.key === 'finance.numbering')?.value as Numbering | undefined;
  const [value, setValue] = useState<Numbering>(DEFAULTS);
  useEffect(() => {
    if (saved) setValue(saved);
  }, [JSON.stringify(saved)]);
  const put = useMutation({
    mutationFn: async () => unwrap(await api.PUT('/settings/{key}', { params: { path: { key: 'finance.numbering' } }, body: { value } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  const set = (t: keyof Numbering, patch: Partial<Format>) => setValue((v) => ({ ...v, [t]: { ...v[t], ...patch } }));

  return (
    <Card>
      <CardHeader title="Invoice numbering" />
      <CardBody className="space-y-3">
        <p className="text-sm text-muted-foreground">Numbers are given when a document is approved. With the year shown, numbering restarts each year.</p>
        {(Object.keys(LABEL) as (keyof Numbering)[]).map((t) => (
          <div key={t} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-36">{LABEL[t]}</span>
            <Input className="h-8 w-24" value={value[t].prefix} onChange={(e) => set(t, { prefix: e.target.value })} aria-label={`${LABEL[t]} prefix`} />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={value[t].include_year} onChange={(e) => set(t, { include_year: e.target.checked })} /> Year
            </label>
            <Input type="number" min={1} max={10} className="h-8 w-16" value={value[t].padding} onChange={(e) => set(t, { padding: Number(e.target.value) })} aria-label={`${LABEL[t]} digits`} />
            <span className="text-xs text-muted-foreground">e.g. {example(value[t])}</span>
          </div>
        ))}
        {put.error ? <Alert>{errorMessage(put.error)}</Alert> : null}
        {put.isSuccess ? <Alert tone="success">Saved.</Alert> : null}
        <div className="flex justify-end">
          <Button disabled={put.isPending} onClick={() => put.mutate()}>
            Save numbering
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
