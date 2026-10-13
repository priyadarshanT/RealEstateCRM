'use client';

import { Alert, Button, Dialog, DialogContent, Field, Input, Select, Table, Td, Th, Tr } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useState } from 'react';
import { errorMessage } from '@/core/api';
import { formatDateTime } from '@/core/format';
import { useEnquiries, useEnquiryActions, usePlatformMe } from './platform-api';

type Enquiry = Schemas['SalesEnquiry'];

/** "Talk to sales" enquiries; our team sets up Enterprise companies with the agreed price (SRS §12 Signing up 7). */
export function EnquiriesScreen() {
  const me = usePlatformMe();
  const [status, setStatus] = useState<Enquiry['status'] | ''>('');
  const enquiries = useEnquiries(status || undefined);
  const { update } = useEnquiryActions();
  const [creating, setCreating] = useState<Enquiry | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Sales enquiries</h2>
        <Select className="h-8 w-auto text-xs" value={status} onChange={(e) => setStatus(e.target.value as Enquiry['status'] | '')} aria-label="Status">
          <option value="">All</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </Select>
      </div>
      {update.error ? <Alert>{errorMessage(update.error)}</Alert> : null}
      <Table>
        <thead>
          <tr>
            <Th>Company</Th>
            <Th>Contact</Th>
            <Th>Users</Th>
            <Th>Message</Th>
            <Th>Received</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {(enquiries.data ?? []).map((e) => (
            <Tr key={e.id}>
              <Td className="font-medium">{e.companyName}</Td>
              <Td>
                {e.contactName}
                <span className="block text-xs text-muted-foreground">
                  {e.email} {e.phone ? `· ${e.phone}` : ''}
                </span>
              </Td>
              <Td>{e.usersEstimate ?? '—'}</Td>
              <Td className="max-w-64 text-xs">{e.message ?? '—'}</Td>
              <Td className="text-xs">{formatDateTime(e.createdAt)}</Td>
              <Td>
                <Select className="h-7 w-28 text-xs" value={e.status} onChange={(ev) => update.mutate({ id: e.id!, status: ev.target.value as Enquiry['status'] })} aria-label="Enquiry status">
                  <option value="new">New</option>
                  <option value="contacted">Contacted</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                </Select>
              </Td>
              <Td>
                {me.data?.role === 'owner' && e.status !== 'won' ? (
                  <Button variant="link" size="sm" onClick={() => setCreating(e)}>
                    Create company
                  </Button>
                ) : null}
              </Td>
            </Tr>
          ))}
          {enquiries.data?.length === 0 ? (
            <tr>
              <Td colSpan={7} className="text-center text-muted-foreground">
                No enquiries.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
      <CreateCompanyDialog enquiry={creating} onClose={() => setCreating(null)} />
    </div>
  );
}

function CreateCompanyDialog({ enquiry, onClose }: { enquiry: Enquiry | null; onClose: () => void }) {
  const { createCompany } = useEnquiryActions();
  const [f, setF] = useState<Record<string, string>>({});
  const v = (k: string, d = '') => f[k] ?? d;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  if (!enquiry) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && (setF({}), createCompany.reset(), onClose())}>
      <DialogContent title={`Set up ${enquiry.companyName}`} wide>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await createCompany
              .mutateAsync({
                id: enquiry.id!,
                tenantType: 'brokerage',
                companyName: v('companyName', enquiry.companyName),
                tradeLicenseNo: v('tradeLicenseNo'),
                reraOrn: v('reraOrn'),
                adminEmail: v('adminEmail', enquiry.email),
                adminFullName: v('adminFullName', enquiry.contactName),
                seats: Number(v('seats', String(enquiry.usersEstimate ?? 10))),
                pricePerSeat: Number(v('pricePerSeat', '99')).toFixed(2),
                billingCycle: v('billingCycle', 'yearly'),
                paymentMethod: v('paymentMethod', 'bank_transfer'),
                trialDays: Number(v('trialDays', '0')),
              })
              .catch(() => null);
            if (ok) {
              setF({});
              onClose();
            }
          }}
        >
          <Field label="Company name">
            <Input value={v('companyName', enquiry.companyName)} onChange={set('companyName')} required />
          </Field>
          <Field label="Trade licence no.">
            <Input value={v('tradeLicenseNo')} onChange={set('tradeLicenseNo')} required />
          </Field>
          <Field label="RERA ORN">
            <Input value={v('reraOrn')} onChange={set('reraOrn')} required />
          </Field>
          <Field label="Admin name">
            <Input value={v('adminFullName', enquiry.contactName)} onChange={set('adminFullName')} required />
          </Field>
          <Field label="Admin email">
            <Input type="email" value={v('adminEmail', enquiry.email)} onChange={set('adminEmail')} required />
          </Field>
          <Field label="Seats">
            <Input type="number" min={1} value={v('seats', String(enquiry.usersEstimate ?? 10))} onChange={set('seats')} />
          </Field>
          <Field label="Agreed price per seat (AED)">
            <Input inputMode="decimal" value={v('pricePerSeat', '99')} onChange={set('pricePerSeat')} />
          </Field>
          <Field label="Billing">
            <Select value={v('billingCycle', 'yearly')} onChange={set('billingCycle')}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </Select>
          </Field>
          <Field label="Payment">
            <Select value={v('paymentMethod', 'bank_transfer')} onChange={set('paymentMethod')}>
              <option value="bank_transfer">Bank transfer</option>
              <option value="card">Card</option>
            </Select>
          </Field>
          <Field label="Trial days">
            <Input type="number" min={0} value={v('trialDays', '0')} onChange={set('trialDays')} />
          </Field>
          {createCompany.error ? <Alert className="sm:col-span-2">{errorMessage(createCompany.error)}</Alert> : null}
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={createCompany.isPending}>
              Create company and invite Admin
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
