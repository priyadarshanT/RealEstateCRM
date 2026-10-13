'use client';

import type { paths, Schemas } from '@crm/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/core/api';

export type PlatformTenant = Schemas['PlatformTenant'];
export type TenantQuery = NonNullable<paths['/platform/tenants']['get']['parameters']['query']>;

export function usePlatformMe() {
  return useQuery({ queryKey: ['platform', 'me'], staleTime: 5 * 60_000, queryFn: async () => unwrap(await api.GET('/platform/me')) });
}

export function useMetrics() {
  return useQuery({ queryKey: ['platform', 'metrics'], queryFn: async () => unwrap(await api.GET('/platform/metrics')) });
}

export function useTenants(query: TenantQuery) {
  return useQuery({
    queryKey: ['platform', 'tenants', query],
    placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await api.GET('/platform/tenants', { params: { query: { limit: 100, ...query } } })).data,
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['platform'] });
}

export function useTenantActions() {
  const onSuccess = useRefresh();
  return {
    verify: useMutation({
      mutationFn: async ({ id, result, note }: { id: string; result: 'verified' | 'rejected'; note?: string }) =>
        unwrap(await api.POST('/platform/tenants/{id}/verify', { params: { path: { id } }, body: { result, ...(note ? { note } : {}) } as never })),
      onSuccess,
    }),
    extend: useMutation({
      mutationFn: async ({ id, days, note }: { id: string; days: number; note: string }) =>
        unwrap(await api.POST('/platform/tenants/{id}/extend', { params: { path: { id } }, body: { days, note } })),
      onSuccess,
    }),
    suspend: useMutation({
      mutationFn: async ({ id, reason }: { id: string; reason: string }) => unwrap(await api.POST('/platform/tenants/{id}/suspend', { params: { path: { id } }, body: { reason } })),
      onSuccess,
    }),
    unsuspend: useMutation({ mutationFn: async (id: string) => unwrap(await api.POST('/platform/tenants/{id}/unsuspend', { params: { path: { id } } })), onSuccess }),
    subscription: useMutation({
      mutationFn: async ({ id, ...body }: { id: string; pricePerSeat?: string; seats?: number; note: string }) =>
        unwrap(await api.PATCH('/platform/subscriptions/{id}', { params: { path: { id } }, body: body as never })),
      onSuccess,
    }),
  };
}

export function useBankTransfers() {
  return useQuery({
    queryKey: ['platform', 'bank-transfers'],
    queryFn: async () => unwrap(await api.GET('/platform/bank-transfers', { params: { query: { limit: 100 } } })).data,
  });
}

export function usePlatformInvoices(status?: 'open' | 'paid' | 'void' | 'uncollectible') {
  return useQuery({
    queryKey: ['platform', 'invoices', status],
    queryFn: async () => unwrap(await api.GET('/platform/billing-invoices', { params: { query: { limit: 100, ...(status ? { status } : {}) } } })).data,
  });
}

export function useBillingActions() {
  const onSuccess = useRefresh();
  return {
    confirm: useMutation({
      mutationFn: async ({ id, amount, receivedAt }: { id: string; amount: string; receivedAt: string }) =>
        unwrap(await api.POST('/platform/billing-payments/{id}/confirm', { params: { path: { id } }, body: { amount, receivedAt } })),
      onSuccess,
    }),
    reject: useMutation({
      mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
        unwrap(await api.POST('/platform/billing-payments/{id}/reject', { params: { path: { id } }, body: { reason } })),
      onSuccess,
    }),
    voidInvoice: useMutation({
      mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
        unwrap(await api.POST('/platform/billing-invoices/{id}/void', { params: { path: { id } }, body: { reason } })),
      onSuccess,
    }),
  };
}

export function useEnquiries(status?: Schemas['SalesEnquiry']['status']) {
  return useQuery({
    queryKey: ['platform', 'enquiries', status],
    queryFn: async () => unwrap(await api.GET('/platform/sales-enquiries', { params: { query: { limit: 100, ...(status ? { status } : {}) } } })).data,
  });
}

export function useEnquiryActions() {
  const onSuccess = useRefresh();
  return {
    update: useMutation({
      mutationFn: async ({ id, status, note }: { id: string; status: Schemas['SalesEnquiry']['status']; note?: string }) =>
        unwrap(await api.PATCH('/platform/sales-enquiries/{id}', { params: { path: { id } }, body: { status, ...(note ? { note } : {}) } as never })),
      onSuccess,
    }),
    createCompany: useMutation({
      mutationFn: async ({ id, ...body }: { id: string } & Record<string, unknown>) =>
        unwrap(await api.POST('/platform/sales-enquiries/{id}/create-company', { params: { path: { id } }, body: body as never })),
      onSuccess,
    }),
  };
}

export function usePlatformPlans() {
  return useQuery({ queryKey: ['platform', 'plans'], queryFn: async () => unwrap(await api.GET('/platform/plans')).data });
}

export function usePlanUpdate() {
  const onSuccess = useRefresh();
  return useMutation({
    mutationFn: async ({ id, ...body }: Partial<Schemas['Plan']> & { id: string }) =>
      unwrap(await api.PATCH('/platform/plans/{id}', { params: { path: { id } }, body: body as Schemas['Plan'] })),
    onSuccess,
  });
}

export function useAuditLogs() {
  return useQuery({
    queryKey: ['platform', 'audit'],
    queryFn: async () => unwrap(await api.GET('/platform/audit-logs', { params: { query: { limit: 100 } } })).data,
  });
}
