'use client';

import { Alert, Badge, Button, Card, CardBody, CardHeader, Select, Table, Td, Th, Tr } from '@crm/ui';
import { useState } from 'react';
import { errorMessage } from '@/core/api';
import { formatDate, formatDateTime, formatMoney } from '@/core/format';
import { useBankTransfers, useBillingActions, usePlatformInvoices } from './platform-api';

/** Confirm bank transfers when the money arrives, and void invoices (SRS §12 Paying, Owner console 3). */
export function ConsoleBillingScreen() {
  const transfers = useBankTransfers();
  const [status, setStatus] = useState<'open' | 'paid' | 'void' | 'uncollectible' | ''>('open');
  const invoices = usePlatformInvoices(status || undefined);
  const a = useBillingActions();
  const error = a.confirm.error ?? a.reject.error ?? a.voidInvoice.error;

  return (
    <div className="space-y-4">
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      <Card>
        <CardHeader title="Bank transfers waiting for confirmation" />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Company</Th>
                <Th>Invoice</Th>
                <Th>Reference</Th>
                <Th>Amount</Th>
                <Th>Submitted</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(transfers.data ?? []).map((p) => (
                <Tr key={p.id}>
                  <Td>{p.tenantName ?? '—'}</Td>
                  <Td>#{p.invoiceNumber ?? ''}</Td>
                  <Td>{p.bankReference ?? '—'}</Td>
                  <Td>{formatMoney(p.amount, p.currency)}</Td>
                  <Td className="text-xs">{formatDateTime(p.createdAt)}</Td>
                  <Td className="whitespace-nowrap">
                    {p.status === 'pending' ? (
                      <>
                        <Button size="sm" onClick={() => a.confirm.mutate({ id: p.id, amount: p.amount, receivedAt: new Date().toISOString() })}>
                          Money received
                        </Button>
                        <Button
                          size="sm"
                          variant="link"
                          className="ml-2 text-danger"
                          onClick={() => {
                            const reason = window.prompt('Why is this transfer rejected?');
                            if (reason) a.reject.mutate({ id: p.id, reason });
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    ) : (
                      <Badge>{p.status}</Badge>
                    )}
                  </Td>
                </Tr>
              ))}
              {transfers.data?.length === 0 ? (
                <tr>
                  <Td colSpan={6} className="text-center text-muted-foreground">
                    Nothing waiting.
                  </Td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Subscription invoices"
          actions={
            <Select className="h-8 w-auto text-xs" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Invoice status">
              <option value="open">Unpaid</option>
              <option value="paid">Paid</option>
              <option value="void">Void</option>
              <option value="uncollectible">Uncollectible</option>
              <option value="">All</option>
            </Select>
          }
        />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>No.</Th>
                <Th>Period</Th>
                <Th>Due</Th>
                <Th>Total</Th>
                <Th>Balance</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(invoices.data ?? []).map((i) => (
                <Tr key={i.id}>
                  <Td>#{i.number}</Td>
                  <Td className="text-xs">
                    {formatDate(i.periodStart)} – {formatDate(i.periodEnd)}
                  </Td>
                  <Td className="text-xs">{formatDate(i.dueDate)}</Td>
                  <Td>{formatMoney(i.total, i.currency)}</Td>
                  <Td>{formatMoney(i.balance, i.currency)}</Td>
                  <Td>
                    <Badge tone={i.status === 'paid' ? 'success' : i.status === 'open' ? 'danger' : 'neutral'}>{i.status}</Badge>
                  </Td>
                  <Td>
                    {i.status === 'open' ? (
                      <Button
                        variant="link"
                        size="sm"
                        className="text-danger"
                        onClick={() => {
                          const reason = window.prompt('Why is this invoice void?');
                          if (reason) a.voidInvoice.mutate({ id: i.id, reason });
                        }}
                      >
                        Void
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
              {invoices.data?.length === 0 ? (
                <tr>
                  <Td colSpan={7} className="text-center text-muted-foreground">
                    No invoices.
                  </Td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
