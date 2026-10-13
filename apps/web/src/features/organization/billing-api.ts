'use client';

import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, unwrap } from '@/core/api';

export type Subscription = Schemas['Subscription'];

/** GET /billing/subscription. A company without a subscription answers 404, shown as "no subscription". */
export function useSubscription() {
  return useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: async () => {
      try {
        return unwrap(await api.GET('/billing/subscription'));
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: async () => unwrap(await api.GET('/billing/invoices', { params: { query: { limit: 50 } } })).data,
  });
}

export function usePayments() {
  return useQuery({ queryKey: ['billing', 'payments'], queryFn: async () => unwrap(await api.GET('/billing/payments', { params: { query: { limit: 50 } } })).data });
}

export function useHistory() {
  return useQuery({ queryKey: ['billing', 'history'], queryFn: async () => unwrap(await api.GET('/billing/history', { params: { query: { limit: 50 } } })).data });
}

export function usePlans() {
  return useQuery({ queryKey: ['plans'], staleTime: 10 * 60_000, queryFn: async () => unwrap(await api.GET('/public/plans')).data });
}

export function useBillingMutations() {
  const qc = useQueryClient();
  const on = { onSuccess: () => qc.invalidateQueries({ queryKey: ['billing'] }) };
  return {
    changePlan: useMutation({
      mutationFn: async (body: { planId: string; billingCycle: 'monthly' | 'yearly' }) => unwrap(await api.POST('/billing/subscription/change-plan', { body })),
      ...on,
    }),
    seats: useMutation({ mutationFn: async (seats: number) => unwrap(await api.PUT('/billing/subscription/seats', { body: { seats } })), ...on }),
    paymentMethod: useMutation({
      mutationFn: async (method: 'card' | 'bank_transfer') => unwrap(await api.PUT('/billing/subscription/payment-method', { body: { method } })),
      ...on,
    }),
    cardSetup: useMutation({ mutationFn: async () => unwrap(await api.POST('/billing/card-setup')) }),
    cancel: useMutation({ mutationFn: async (reason: string) => unwrap(await api.POST('/billing/subscription/cancel', { body: { reason } })), ...on }),
    resume: useMutation({ mutationFn: async () => unwrap(await api.POST('/billing/subscription/resume')), ...on }),
    bankTransfer: useMutation({
      mutationFn: async ({ id, amount, bankReference }: { id: string; amount: string; bankReference: string }) =>
        unwrap(await api.POST('/billing/invoices/{id}/bank-transfers', { params: { path: { id } }, body: { amount, bankReference } })),
      ...on,
    }),
    invoicePdf: useMutation({
      mutationFn: async (id: string) => unwrap(await api.GET('/billing/invoices/{id}/pdf', { params: { path: { id } } })),
      onSuccess: (link) => window.open(link.url, '_blank', 'noopener'),
    }),
    dataExport: useMutation({ mutationFn: async () => unwrap(await api.POST('/billing/data-export')) }),
  };
}
