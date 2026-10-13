'use client';

import type { paths, Schemas } from '@crm/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, idempotencyKey, unwrap } from '@/core/api';

export type Lead = Schemas['Lead'];
export type LeadQuery = NonNullable<paths['/leads']['get']['parameters']['query']>;
export type LeadTab = NonNullable<LeadQuery['tab']>;

export function useLeadList(query: LeadQuery) {
  return useQuery({
    queryKey: ['leads', query],
    placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await api.GET('/leads', { params: { query: { limit: 50, total: true, ...query } } })),
  });
}

export function useLead(id: string) {
  return useQuery({ queryKey: ['lead', id], queryFn: async () => unwrap(await api.GET('/leads/{id}', { params: { path: { id } } })) });
}

export function useTimeline(id: string) {
  return useQuery({
    queryKey: ['lead', id, 'timeline'],
    queryFn: async () => unwrap(await api.GET('/leads/{id}/timeline', { params: { path: { id }, query: { limit: 100 } } })).data,
  });
}

export function useInquiries(id: string) {
  return useQuery({
    queryKey: ['lead', id, 'inquiries'],
    queryFn: async () => unwrap(await api.GET('/leads/{id}/inquiries', { params: { path: { id } } })).data,
  });
}

export function useShares(id: string) {
  return useQuery({
    queryKey: ['lead', id, 'shares'],
    queryFn: async () => unwrap(await api.GET('/leads/{id}/shares', { params: { path: { id } } })).data,
  });
}

export function useSavedFilters() {
  return useQuery({
    queryKey: ['saved-filters', 'leads'],
    queryFn: async () => unwrap(await api.GET('/saved-filters', { params: { query: { entity: 'leads' } } })).data,
  });
}

/** Refreshes everything that shows a lead after it changes. */
function useLeadInvalidation() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['leads'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    if (id) void qc.invalidateQueries({ queryKey: ['lead', id] });
  };
}

export function useLeadMutations(id: string) {
  const refresh = useLeadInvalidation();
  const done = { onSuccess: () => refresh(id) };
  return {
    addNote: useMutation({
      mutationFn: async (body: Schemas['Note']) => unwrap(await api.POST('/leads/{id}/notes', { params: { path: { id } }, body })),
      ...done,
    }),
    logCall: useMutation({
      mutationFn: async (body: Schemas['CallLog']) => unwrap(await api.POST('/leads/{id}/calls', { params: { path: { id } }, body })),
      ...done,
    }),
    changeStage: useMutation({
      mutationFn: async (body: Schemas['StageChange']) => unwrap(await api.POST('/leads/{id}/stage', { params: { path: { id } }, body })),
      ...done,
    }),
    setPriority: useMutation({
      mutationFn: async (priority: 'low' | 'medium' | 'high') =>
        unwrap(await api.POST('/leads/{id}/priority', { params: { path: { id } }, body: { priority } })),
      ...done,
    }),
    assign: useMutation({
      mutationFn: async (body: Schemas['Assign']) => unwrap(await api.POST('/leads/{id}/assign', { params: { path: { id } }, body })),
      ...done,
    }),
    update: useMutation({
      mutationFn: async (body: Schemas['LeadUpdate']) => unwrap(await api.PATCH('/leads/{id}', { params: { path: { id } }, body })),
      ...done,
    }),
    share: useMutation({
      mutationFn: async (body: Schemas['Share']) => unwrap(await api.POST('/leads/{id}/shares', { params: { path: { id } }, body })),
      ...done,
    }),
    unshare: useMutation({
      mutationFn: async (userId: string) => unwrap(await api.DELETE('/leads/{id}/shares/{userId}', { params: { path: { id, userId } } })),
      ...done,
    }),
    remove: useMutation({
      mutationFn: async () => unwrap(await api.DELETE('/leads/{id}', { params: { path: { id } } })),
      ...done,
    }),
    restore: useMutation({
      mutationFn: async () => unwrap(await api.POST('/leads/{id}/restore', { params: { path: { id } } })),
      ...done,
    }),
  };
}

export function useCreateLead() {
  const refresh = useLeadInvalidation();
  return useMutation({
    mutationFn: async (body: Schemas['LeadCreate']) =>
      unwrap(await api.POST('/leads', { body, params: { header: { 'Idempotency-Key': idempotencyKey() } } })),
    onSuccess: () => refresh(),
  });
}

export function useBulkLeads() {
  const refresh = useLeadInvalidation();
  return useMutation({
    mutationFn: async (body: Schemas['BulkLeadAction']) => unwrap(await api.POST('/leads/bulk', { body })),
    onSuccess: () => refresh(),
  });
}

export async function checkExisting(phone?: string, email?: string) {
  return unwrap(await api.GET('/leads/check-existing', { params: { query: { ...(phone ? { phone } : {}), ...(email ? { email } : {}) } } }));
}
