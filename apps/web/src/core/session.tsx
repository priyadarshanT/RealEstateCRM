'use client';

import type { Schemas } from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './api';

export type Me = Schemas['Me'];

/** The signed-in user, tenant, permissions and data scope (GET /me). */
export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: async () => unwrap(await api.GET('/me')), staleTime: 5 * 60_000 });
}

/** True when the signed-in user has the permission. Screens hide what users cannot use; the API still checks. */
export function useCan(): (permission: string) => boolean {
  const { data } = useMe();
  return (permission) => !!data?.permissions.includes(permission);
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}
