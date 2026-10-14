'use client';

import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/core/api';

export type Deal = Schemas['Deal'];
export type DealStage = Deal['stage'];

export const DEAL_STAGE_LABEL: Record<DealStage, string> = { offer: 'Offer', eoi: 'EOI', booking: 'Booking', sold: 'Sold', cancelled: 'Cancelled' };
export const DEAL_STAGE_TONE: Record<DealStage, 'neutral' | 'warning' | 'info' | 'success' | 'danger'> = { offer: 'neutral', eoi: 'warning', booking: 'info', sold: 'success', cancelled: 'danger' };
export const DEAL_STEPS: DealStage[] = ['offer', 'eoi', 'booking', 'sold'];

export function useLeadDeals(leadId: string) {
  return useQuery({ queryKey: ['deals', { leadId }], queryFn: async () => unwrap(await api.GET('/deals', { params: { query: { leadId, limit: 50 } } })).data });
}

export function useAvailableUnits(projectId: string | undefined) {
  return useQuery({
    queryKey: ['units', projectId, { forDeal: true }],
    enabled: !!projectId,
    queryFn: async () => unwrap(await api.GET('/units', { params: { query: { projectId: projectId!, limit: 200 } } })).data,
  });
}

export function useDealFiles(dealId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['deals', dealId, 'attachments'],
    enabled,
    queryFn: async () => unwrap(await api.GET('/deals/{id}/attachments', { params: { path: { id: dealId } } })).data ?? [],
  });
}

/** Deal changes refresh the deal list, the lead (timeline) and the units (status). */
export function useDealActions(leadId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['deals'] });
    void qc.invalidateQueries({ queryKey: ['lead', leadId] });
    void qc.invalidateQueries({ queryKey: ['units'] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
  };
  return {
    create: useMutation({ mutationFn: async (body: Partial<Deal>) => unwrap(await api.POST('/deals', { body: { leadId, ...body } as Deal })), onSuccess: refresh }),
    update: useMutation({ mutationFn: async ({ id, ...body }: Partial<Deal> & { id: string }) => unwrap(await api.PATCH('/deals/{id}', { params: { path: { id } }, body: body as Deal })), onSuccess: refresh }),
    stage: useMutation({
      mutationFn: async ({ id, ...body }: Schemas['DealStageChange'] & { id: string }) => unwrap(await api.POST('/deals/{id}/stage', { params: { path: { id } }, body })),
      onSuccess: refresh,
    }),
    attach: useMutation({
      mutationFn: async ({ id, fileId, category }: { id: string; fileId: string; category: Schemas['Attachment']['category'] }) =>
        unwrap(await api.POST('/deals/{id}/attachments', { params: { path: { id } }, body: { fileId, category } })),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['deals'] }),
    }),
  };
}
