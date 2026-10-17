'use client';

import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/core/api';

/** Global Configuration switches every screen follows (GET /client-policy); the API enforces the same switches. */
export function useClientPolicy() {
  return useQuery({ queryKey: ['client-policy'], staleTime: 60_000, queryFn: async () => unwrap(await api.GET('/client-policy')) });
}
