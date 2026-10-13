'use client';

import type { paths, Schemas } from '@crm/contracts';
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, idempotencyKey, unwrap } from '@/core/api';

export type Conversation = Schemas['Conversation'];
export type Message = Schemas['Message'];
export type Template = Schemas['MessageTemplate'];
export type Consent = Schemas['Consent'];
export type Channel = 'whatsapp' | 'email';
export type ConversationQuery = NonNullable<paths['/conversations']['get']['parameters']['query']>;

export const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: 'WhatsApp', email: 'Email' };

export function useConversations(query: ConversationQuery) {
  return useQuery({
    queryKey: ['conversations', query],
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    queryFn: async () => unwrap(await api.GET('/conversations', { params: { query: { limit: 100, ...query } } })).data,
  });
}

export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['conversation', conversationId, 'messages'],
    enabled: !!conversationId,
    refetchInterval: 15_000,
    queryFn: async () => unwrap(await api.GET('/conversations/{id}/messages', { params: { path: { id: conversationId! }, query: { limit: 100 } } })).data,
  });
}

/** Lead names for a list of conversations (the contract's Conversation carries only the lead ID). */
export function useLeadNames(leadIds: string[]) {
  const results = useQueries({
    queries: [...new Set(leadIds)].map((id) => ({
      queryKey: ['lead', id],
      staleTime: 5 * 60_000,
      queryFn: async () => unwrap(await api.GET('/leads/{id}', { params: { path: { id } } })),
    })),
  });
  return new Map(results.flatMap((r) => (r.data ? [[r.data.id, r.data.fullName] as const] : [])));
}

export function useTemplates(query: NonNullable<paths['/message-templates']['get']['parameters']['query']> = {}) {
  return useQuery({
    queryKey: ['message-templates', query],
    queryFn: async () => unwrap(await api.GET('/message-templates', { params: { query: { limit: 200, ...query } } })).data,
  });
}

export function useConsents(leadId: string) {
  return useQuery({
    queryKey: ['lead', leadId, 'consents'],
    queryFn: async () => unwrap(await api.GET('/leads/{id}/consents', { params: { path: { id: leadId } } })).data,
  });
}

/** Latest consent per channel (history is newest first; the latest row wins). */
export function latestConsent(history: Consent[] | undefined, channel: Consent['channel']): Consent | undefined {
  return history?.find((c) => c.channel === channel);
}

function useRefresh() {
  const qc = useQueryClient();
  return (leadId?: string) => {
    void qc.invalidateQueries({ queryKey: ['conversations'] });
    void qc.invalidateQueries({ queryKey: ['conversation'] });
    if (leadId) void qc.invalidateQueries({ queryKey: ['lead', leadId] });
  };
}

export function useSendMessage(leadId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (body: Schemas['MessageSend']) =>
      unwrap(await api.POST('/leads/{id}/messages', { params: { path: { id: leadId }, header: { 'Idempotency-Key': idempotencyKey() } }, body })),
    // The provider answers in the background; check again shortly for "sent" or "failed".
    onSuccess: () => {
      refresh(leadId);
      setTimeout(() => refresh(leadId), 2500);
    },
  });
}

export function useMarkRead() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await api.POST('/conversations/{id}/read', { params: { path: { id } } })),
    onSuccess: () => refresh(),
  });
}

export function useRecordConsent(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Omit<Consent, 'recordedAt'>) => unwrap(await api.POST('/leads/{id}/consents', { params: { path: { id: leadId } }, body: body as Consent })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead', leadId] }),
  });
}

export function useTemplateMutations() {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: ['message-templates'] });
  return {
    create: useMutation({ mutationFn: async (body: Partial<Template>) => unwrap(await api.POST('/message-templates', { body: body as Template })), onSuccess }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: Partial<Template> & { id: string }) => unwrap(await api.PATCH('/message-templates/{id}', { params: { path: { id } }, body: body as Template })),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: async (id: string) => unwrap(await api.DELETE('/message-templates/{id}', { params: { path: { id } } })), onSuccess }),
    submit: useMutation({ mutationFn: async (id: string) => unwrap(await api.POST('/message-templates/{id}/submit', { params: { path: { id } } })), onSuccess }),
  };
}

/** Placeholder names in a template ({{first_name}}), in order. */
export function placeholders(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (text ?? '').matchAll(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** Live preview of a filled template (the server fills it for real when sending). */
export function fill(text: string | null | undefined, values: Record<string, string>): string {
  return (text ?? '').replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (m, n: string) => values[n]?.trim() || m);
}
