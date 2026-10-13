'use client';

import type { Schemas } from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './api';
import { useCan, useMe } from './session';

// Reference lists used by many screens (stages, sources, users…). Cached for a few minutes.

const LONG = 5 * 60_000;

export function useStages() {
  return useQuery({
    queryKey: ['lead-stages'],
    staleTime: LONG,
    queryFn: async () => unwrap(await api.GET('/lead-stages', { params: { query: { limit: 100 } } })).data.sort((a, b) => a.sortOrder - b.sortOrder),
  });
}

export function useSources() {
  return useQuery({
    queryKey: ['lead-sources'],
    staleTime: LONG,
    queryFn: async () => unwrap(await api.GET('/lead-sources', { params: { query: { limit: 100 } } })).data,
  });
}

export function useReasons(type?: Schemas['Reason']['type']) {
  return useQuery({
    queryKey: ['reasons', type ?? 'all'],
    staleTime: LONG,
    queryFn: async () => unwrap(await api.GET('/reasons', { params: { query: { limit: 100, ...(type ? { type } : {}) } } })).data,
  });
}

export function useCampaigns() {
  return useQuery({
    queryKey: ['campaigns'],
    staleTime: LONG,
    queryFn: async () => unwrap(await api.GET('/campaigns', { params: { query: { limit: 100 } } })).data,
  });
}

/** Company users. Listing users needs users.manage; others only know themselves. */
export function useUsers() {
  const can = useCan();
  const { data: me } = useMe();
  const allowed = can('users.manage');
  return useQuery({
    queryKey: ['users', allowed],
    staleTime: LONG,
    enabled: !!me,
    queryFn: async (): Promise<Schemas['User'][]> =>
      allowed ? unwrap(await api.GET('/users', { params: { query: { limit: 200 } } })).data : me ? [me.user] : [],
  });
}

export function useTeams() {
  const can = useCan();
  return useQuery({
    queryKey: ['teams'],
    staleTime: LONG,
    enabled: can('users.manage'),
    queryFn: async () => unwrap(await api.GET('/teams', { params: { query: { limit: 100 } } })).data,
  });
}

/** Builds an id → item map for quick name lookups in tables. */
export function byId<T extends { id: string }>(items: T[] | undefined): Map<string, T> {
  return new Map((items ?? []).map((i) => [i.id, i]));
}
