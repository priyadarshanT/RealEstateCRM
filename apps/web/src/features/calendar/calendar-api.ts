'use client';

import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, unwrap } from '@/core/api';

export type Meeting = Schemas['Meeting'];
export type MeetingChannel = Meeting['channel'];
export type BookingPage = Schemas['BookingPage'];

export type MeetingType = Meeting['type'];
export const CHANNEL_LABEL: Record<MeetingChannel, string> = { google_meet: 'Google Meet', teams: 'Microsoft Teams', in_person: 'In person', phone: 'Phone call', online_link: 'Online meeting link' };
/** Appointment types of the Lead page (§3.6). */
export const TYPE_LABEL: Record<MeetingType, string> = { call: 'Call', meeting: 'Zoom / online meeting', event: 'Event', viewing: 'Property viewing' };

/** A lead's appointments, newest first (Appointments card on the lead page). */
export function useLeadMeetings(leadId: string) {
  return useQuery({
    queryKey: ['meetings', 'lead', leadId],
    queryFn: async () => unwrap(await api.GET('/meetings', { params: { query: { leadId, limit: 100 } } })).data,
  });
}

/** Appointments in a period, in the user's access (calendar view). */
export function useMeetingsInRange(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['meetings', 'range', from, to],
    enabled,
    queryFn: async () => unwrap(await api.GET('/meetings', { params: { query: { from, to, limit: 200 } } })).data,
  });
}

export function useMeeting(id: string | null | undefined) {
  return useQuery({
    queryKey: ['meeting', id],
    enabled: !!id,
    queryFn: async () => unwrap(await api.GET('/meetings/{id}', { params: { path: { id: id! } } })),
  });
}

export function useAvailability(userId: string | undefined, from: string, to: string, durationMinutes: number) {
  return useQuery({
    queryKey: ['availability', userId, from, to, durationMinutes],
    enabled: !!userId,
    queryFn: async () => unwrap(await api.GET('/availability', { params: { query: { userId: userId!, from, to, durationMinutes } } })).slots,
  });
}

/** The signed-in user's booking page, or null when they have not saved one yet. */
export function useMyBookingPage() {
  return useQuery({
    queryKey: ['booking-page', 'me'],
    queryFn: async () => {
      try {
        return unwrap(await api.GET('/booking-pages/me'));
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return (leadId?: string) => {
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['meeting'] });
    void qc.invalidateQueries({ queryKey: ['meetings'] });
    void qc.invalidateQueries({ queryKey: ['availability'] });
    void qc.invalidateQueries({ queryKey: ['leads'] });
    if (leadId) void qc.invalidateQueries({ queryKey: ['lead', leadId] });
  };
}

export function useMeetingActions() {
  const refresh = useRefresh();
  const path = (id: string) => ({ params: { path: { id } } });
  return {
    create: useMutation({
      mutationFn: async (body: Schemas['MeetingCreate']) => unwrap(await api.POST('/meetings', { body })),
      onSuccess: (m) => refresh(m.leadId),
    }),
    reschedule: useMutation({
      mutationFn: async ({ id, ...body }: { id: string; startsAt?: string; endsAt?: string; location?: string; notes?: string }) =>
        unwrap(await api.PATCH('/meetings/{id}', { ...path(id), body: body as never })),
      onSuccess: (m) => refresh(m.leadId),
    }),
    cancel: useMutation({
      mutationFn: async ({ id, reason }: { id: string; reason: string }) => unwrap(await api.POST('/meetings/{id}/cancel', { ...path(id), body: { reason } })),
      onSuccess: (m) => refresh(m.leadId),
    }),
    complete: useMutation({
      mutationFn: async ({ id, ...body }: { id: string; status: 'completed' | 'no_show'; note?: string; nextAction?: { type: 'call' | 'follow_up' | 'meeting' | 'viewing'; dueAt: string } }) =>
        unwrap(await api.POST('/meetings/{id}/complete', { ...path(id), body: body as never })),
      onSuccess: (m) => refresh(m.leadId),
    }),
  };
}

export function useSaveBookingPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Omit<BookingPage, 'id' | 'publicUrl'>) => unwrap(await api.PUT('/booking-pages/me', { body: body as BookingPage })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['booking-page'] }),
  });
}
