'use client';

import { Alert, Badge, Input, Loading, Table, Td, Th, Tr } from '@crm/ui';
import { errorMessage } from '@/core/api';
import { formatDateTime } from '@/core/format';
import { useAuditLogs, usePlanUpdate, usePlatformMe, usePlatformPlans } from './platform-api';

/** Plans and prices (SRS §12 Plans and prices). Only the owner role can change prices; every change is logged. */
export function PlansScreen() {
  const me = usePlatformMe();
  const plans = usePlatformPlans();
  const update = usePlanUpdate();
  const owner = me.data?.role === 'owner';

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">Plans and prices (AED, excluding 5% VAT)</h2>
      {update.error ? <Alert>{errorMessage(update.error)}</Alert> : null}
      {update.isSuccess ? <Alert tone="success">Saved.</Alert> : null}
      <Table>
        <thead>
          <tr>
            <Th>Plan</Th>
            <Th>For</Th>
            <Th>Per user / month</Th>
            <Th>Per user / year</Th>
            <Th>Seats</Th>
            <Th>Self service</Th>
            <Th>Active</Th>
          </tr>
        </thead>
        <tbody>
          {(plans.data ?? []).map((p) => (
            <Tr key={p.id}>
              <Td className="font-medium">{p.name}</Td>
              <Td>{p.tenantType === 'individual' ? 'Individual agent' : 'Brokerage'}</Td>
              <Td>
                <Input
                  className="h-7 w-24 text-xs"
                  defaultValue={p.priceMonthly}
                  disabled={!owner}
                  onBlur={(e) => e.target.value !== p.priceMonthly && update.mutate({ id: p.id, priceMonthly: Number(e.target.value).toFixed(2) })}
                  aria-label={`${p.name} monthly price`}
                />
              </Td>
              <Td>
                <Input
                  className="h-7 w-24 text-xs"
                  defaultValue={p.priceYearly}
                  disabled={!owner}
                  onBlur={(e) => e.target.value !== p.priceYearly && update.mutate({ id: p.id, priceYearly: Number(e.target.value).toFixed(2) })}
                  aria-label={`${p.name} yearly price`}
                />
              </Td>
              <Td>
                {p.minSeats}–{p.maxSeats ?? '∞'}
              </Td>
              <Td>{p.selfService ? <Badge tone="success">Yes</Badge> : <Badge>Sales</Badge>}</Td>
              <Td>
                <input type="checkbox" checked={p.isActive !== false} disabled={!owner} onChange={(e) => update.mutate({ id: p.id, isActive: e.target.checked })} aria-label={`${p.name} active`} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/** Every owner-console action is logged (SRS §12 Owner console 5). */
export function AuditScreen() {
  const logs = useAuditLogs();
  if (logs.isLoading) return <Loading />;
  if (logs.error) return <Alert>{errorMessage(logs.error)}</Alert>;
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">Audit log</h2>
      <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Action</Th>
            <Th>Record</Th>
            <Th>Changes</Th>
          </tr>
        </thead>
        <tbody>
          {(logs.data ?? []).map((l, i) => {
            const entry = l as Record<string, unknown>;
            return (
              <Tr key={String(entry.id ?? i)}>
                <Td className="whitespace-nowrap text-xs">{formatDateTime(String(entry.createdAt ?? ''))}</Td>
                <Td>{String(entry.action ?? '')}</Td>
                <Td className="text-xs">{String(entry.entityType ?? '')}</Td>
                <Td className="max-w-md truncate text-xs">{entry.changes ? JSON.stringify(entry.changes) : '—'}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
