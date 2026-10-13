'use client';

import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/core/api';

export type Campaign = Schemas['MessageCampaign'];
export type CampaignStatus = Campaign['status'];

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  sending: 'Sending',
  completed: 'Sent',
  cancelled: 'Cancelled',
};

export const STATUS_TONE: Record<CampaignStatus, 'neutral' | 'warning' | 'success' | 'danger' | 'info' | 'primary'> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'primary',
  rejected: 'danger',
  sending: 'info',
  completed: 'success',
  cancelled: 'neutral',
};

/** Placeholders a campaign fills from each lead (campaigns have no per-message values). */
export const CAMPAIGN_FIELDS = ['first_name', 'full_name'];

export function useCampaignList() {
  return useQuery({
    queryKey: ['message-campaigns'],
    refetchInterval: 20_000,
    queryFn: async () => unwrap(await api.GET('/message-campaigns', { params: { query: { limit: 100 } } })).data,
  });
}

export function useCampaignReport(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['message-campaigns', id, 'report'],
    enabled: !!id && enabled,
    refetchInterval: 15_000,
    queryFn: async () => unwrap(await api.GET('/message-campaigns/{id}/report', { params: { path: { id: id! } } })),
  });
}

export function useCampaignActions() {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: ['message-campaigns'] });
  const path = (id: string) => ({ params: { path: { id } } });
  return {
    create: useMutation({ mutationFn: async (body: Partial<Campaign>) => unwrap(await api.POST('/message-campaigns', { body: body as Campaign })), onSuccess }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: Partial<Campaign> & { id: string }) => unwrap(await api.PATCH('/message-campaigns/{id}', { ...path(id), body: body as Campaign })),
      onSuccess,
    }),
    preview: useMutation({ mutationFn: async (id: string) => unwrap(await api.POST('/message-campaigns/{id}/preview-audience', path(id))) }),
    test: useMutation({
      mutationFn: async ({ id, to }: { id: string; to: string }) => unwrap(await api.POST('/message-campaigns/{id}/test', { ...path(id), body: { to } })),
      onSuccess,
    }),
    submit: useMutation({ mutationFn: async (id: string) => unwrap(await api.POST('/message-campaigns/{id}/submit', path(id))), onSuccess }),
    approve: useMutation({ mutationFn: async (id: string) => unwrap(await api.POST('/message-campaigns/{id}/approve', path(id))), onSuccess }),
    reject: useMutation({
      mutationFn: async ({ id, note }: { id: string; note: string }) => unwrap(await api.POST('/message-campaigns/{id}/reject', { ...path(id), body: { note } })),
      onSuccess,
    }),
    cancel: useMutation({ mutationFn: async (id: string) => unwrap(await api.POST('/message-campaigns/{id}/cancel', path(id))), onSuccess }),
  };
}
