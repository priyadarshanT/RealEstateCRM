'use client';

import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, idempotencyKey, unwrap } from '@/core/api';

export type FinanceDocument = Schemas['FinanceDocument'];
export type DocType = FinanceDocument['docType'];
export type DocStatus = FinanceDocument['status'];
export type Counterparty = Schemas['Counterparty'];
export type Commission = Schemas['Commission'];
export type DocumentLine = Schemas['DocumentLine'];

export const DOC_TYPE_LABEL: Record<DocType, string> = { sales_invoice: 'Sales invoice', purchase_invoice: 'Purchase invoice', purchase_order: 'Purchase order' };
export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};
export const DOC_STATUS_TONE: Record<DocStatus, 'neutral' | 'primary' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  approved: 'primary',
  sent: 'info',
  partially_paid: 'warning',
  paid: 'success',
  overdue: 'danger',
  cancelled: 'neutral',
  refunded: 'neutral',
};
export const COUNTERPARTY_LABEL: Record<Counterparty['type'], string> = { client: 'Client', developer: 'Developer', vendor: 'Vendor' };

export type DocFilters = { docType?: DocType; status?: DocStatus; counterpartyId?: string; from?: string; to?: string };

export function useDocuments(filters: DocFilters) {
  return useQuery({ queryKey: ['finance-documents', filters], queryFn: async () => unwrap(await api.GET('/finance-documents', { params: { query: { limit: 100, ...filters } } })) });
}

export function useDocument(id: string | null) {
  return useQuery({ queryKey: ['finance-documents', id], enabled: !!id, queryFn: async () => unwrap(await api.GET('/finance-documents/{id}', { params: { path: { id: id! } } })) });
}

export function useDocumentPayments(id: string | null) {
  return useQuery({ queryKey: ['finance-documents', id, 'payments'], enabled: !!id, queryFn: async () => unwrap(await api.GET('/finance-documents/{id}/payments', { params: { path: { id: id! } } })).data ?? [] });
}

export function useDocumentHistory(id: string | null) {
  return useQuery({ queryKey: ['finance-documents', id, 'history'], enabled: !!id, queryFn: async () => unwrap(await api.GET('/finance-documents/{id}/history', { params: { path: { id: id! } } })).data ?? [] });
}

export function useDocumentFiles(id: string | null) {
  return useQuery({ queryKey: ['finance-documents', id, 'files'], enabled: !!id, queryFn: async () => unwrap(await api.GET('/finance-documents/{id}/attachments', { params: { path: { id: id! } } })).data ?? [] });
}

export function useCounterparties(type?: Counterparty['type']) {
  return useQuery({
    queryKey: ['counterparties', type ?? 'all'],
    queryFn: async () => unwrap(await api.GET('/counterparties', { params: { query: { limit: 200, ...(type ? { type } : {}) } } })).data,
  });
}

export function useCommissions() {
  return useQuery({ queryKey: ['commissions'], queryFn: async () => unwrap(await api.GET('/commissions', { params: { query: { limit: 200 } } })).data });
}

export function useAllDeals() {
  return useQuery({ queryKey: ['deals', 'all'], queryFn: async () => unwrap(await api.GET('/deals', { params: { query: { limit: 200 } } })).data });
}

export function useFinanceActions() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['finance-documents'] });
    void qc.invalidateQueries({ queryKey: ['counterparties'] });
    void qc.invalidateQueries({ queryKey: ['commissions'] });
  };
  return {
    createCounterparty: useMutation({
      mutationFn: async (body: Partial<Counterparty>) => unwrap(await api.POST('/counterparties', { params: { header: { 'Idempotency-Key': idempotencyKey() } }, body: body as Counterparty })),
      onSuccess: refresh,
    }),
    createDocument: useMutation({
      mutationFn: async (body: Partial<FinanceDocument>) =>
        unwrap(await api.POST('/finance-documents', { params: { header: { 'Idempotency-Key': idempotencyKey() } }, body: body as FinanceDocument })),
      onSuccess: refresh,
    }),
    updateDocument: useMutation({
      mutationFn: async ({ id, ...body }: Partial<FinanceDocument> & { id: string }) => unwrap(await api.PATCH('/finance-documents/{id}', { params: { path: { id } }, body: body as FinanceDocument })),
      onSuccess: refresh,
    }),
    approve: useMutation({ mutationFn: async (id: string) => unwrap(await api.POST('/finance-documents/{id}/approve', { params: { path: { id } } })), onSuccess: refresh }),
    send: useMutation({
      mutationFn: async ({ id, to, message }: { id: string; to?: string[]; message?: string }) =>
        unwrap(await api.POST('/finance-documents/{id}/send', { params: { path: { id } }, body: { ...(to?.length ? { to } : {}), ...(message ? { message } : {}) } })),
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: async ({ id, reason }: { id: string; reason: string }) => unwrap(await api.POST('/finance-documents/{id}/cancel', { params: { path: { id } }, body: { reason } })),
      onSuccess: refresh,
    }),
    pay: useMutation({
      mutationFn: async ({ id, ...body }: Omit<Schemas['Payment'], 'id'> & { id: string }) =>
        unwrap(await api.POST('/finance-documents/{id}/payments', { params: { path: { id }, header: { 'Idempotency-Key': idempotencyKey() } }, body: body as Schemas['Payment'] })),
      onSuccess: refresh,
    }),
    attach: useMutation({
      mutationFn: async ({ id, fileId, category }: { id: string; fileId: string; category: Schemas['Attachment']['category'] }) =>
        unwrap(await api.POST('/finance-documents/{id}/attachments', { params: { path: { id } }, body: { fileId, category } })),
      onSuccess: refresh,
    }),
    createCommission: useMutation({ mutationFn: async (body: Partial<Commission>) => unwrap(await api.POST('/commissions', { body: body as Commission })), onSuccess: refresh }),
    approveCommission: useMutation({ mutationFn: async (id: string) => unwrap(await api.POST('/commissions/{id}/approve', { params: { path: { id } } })), onSuccess: refresh }),
    markPaid: useMutation({
      mutationFn: async ({ id, paidOn }: { id: string; paidOn: string }) => unwrap(await api.POST('/commissions/{id}/mark-paid', { params: { path: { id } }, body: { paidOn } })),
      onSuccess: refresh,
    }),
  };
}

export function money(v: string | number | null | undefined, currency = 'AED'): string {
  return v === null || v === undefined || v === '' ? '—' : `${currency} ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Same rounding as the server (half up to the cent), for the live totals while typing a draft. */
export function lineTotals(lines: { quantity: string; unitPrice: string; taxRate: string }[]) {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const s = Math.round(Number(l.quantity || 0) * Number(l.unitPrice || 0) * 100 + Number.EPSILON) / 100;
    subtotal += s;
    tax += Math.round(s * Number(l.taxRate || 0) + Number.EPSILON) / 100;
  }
  return { subtotal, tax, total: subtotal + tax };
}
