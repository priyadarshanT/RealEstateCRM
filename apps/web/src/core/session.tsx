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

/** Signs out; with Cognito the answer names its logout page, which ends that session too and comes back. */
export async function logout(): Promise<void> {
  const res = await fetch('/auth/logout', { method: 'POST' });
  window.location.href = ((await res.json().catch(() => ({}))) as { redirect?: string }).redirect ?? '/login';
}
