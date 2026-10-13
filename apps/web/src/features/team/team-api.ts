'use client';

import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/core/api';

export type User = Schemas['User'];
export type Role = Schemas['Role'];
export type Team = Schemas['Team'];
export type Division = Schemas['Division'];

export function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: async () => unwrap(await api.GET('/roles')).data });
}

export function usePermissions() {
  return useQuery({ queryKey: ['permissions'], staleTime: Infinity, queryFn: async () => unwrap(await api.GET('/permissions')).data });
}

export function useDivisions() {
  return useQuery({ queryKey: ['divisions'], queryFn: async () => unwrap(await api.GET('/divisions', { params: { query: { limit: 100 } } })).data });
}

export function useWorkload(id: string | null) {
  return useQuery({
    queryKey: ['workload', id],
    enabled: !!id,
    queryFn: async () => unwrap(await api.GET('/users/{id}/workload', { params: { path: { id: id! } } })),
  });
}

function useRefresh(...keys: string[]) {
  const qc = useQueryClient();
  return () => keys.forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
}

export function useUserMutations() {
  const refresh = useRefresh('users', 'workload', 'leads');
  const on = { onSuccess: refresh };
  return {
    create: useMutation({ mutationFn: async (body: Schemas['UserCreate']) => unwrap(await api.POST('/users', { body })), ...on }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: Partial<User> & { id: string }) => unwrap(await api.PATCH('/users/{id}', { params: { path: { id } }, body: body as User })),
      ...on,
    }),
    receivesLeads: useMutation({
      mutationFn: async ({ id, receivesLeads }: { id: string; receivesLeads: boolean }) =>
        unwrap(await api.PUT('/users/{id}/receives-leads', { params: { path: { id } }, body: { receivesLeads } })),
      ...on,
    }),
    deactivate: useMutation({
      mutationFn: async ({ id, reassignToUserId }: { id: string; reassignToUserId?: string }) =>
        unwrap(await api.POST('/users/{id}/deactivate', { params: { path: { id } }, body: reassignToUserId ? { reassignToUserId } : {} })),
      ...on,
    }),
    reactivate: useMutation({ mutationFn: async (id: string) => unwrap(await api.POST('/users/{id}/reactivate', { params: { path: { id } } })), ...on }),
  };
}

export function useTeamMutations() {
  const refresh = useRefresh('teams', 'divisions', 'users');
  const on = { onSuccess: refresh };
  return {
    createTeam: useMutation({ mutationFn: async (body: Partial<Team>) => unwrap(await api.POST('/teams', { body: body as Team })), ...on }),
    updateTeam: useMutation({
      mutationFn: async ({ id, ...body }: Partial<Team> & { id: string }) => unwrap(await api.PATCH('/teams/{id}', { params: { path: { id } }, body: body as Team })),
      ...on,
    }),
    deleteTeam: useMutation({ mutationFn: async (id: string) => unwrap(await api.DELETE('/teams/{id}', { params: { path: { id } } })), ...on }),
    createDivision: useMutation({ mutationFn: async (body: Partial<Division>) => unwrap(await api.POST('/divisions', { body: body as Division })), ...on }),
    updateDivision: useMutation({
      mutationFn: async ({ id, ...body }: Partial<Division> & { id: string }) =>
        unwrap(await api.PATCH('/divisions/{id}', { params: { path: { id } }, body: body as Division })),
      ...on,
    }),
    deleteDivision: useMutation({ mutationFn: async (id: string) => unwrap(await api.DELETE('/divisions/{id}', { params: { path: { id } } })), ...on }),
  };
}

export function useRoleMutations() {
  const refresh = useRefresh('roles', 'me');
  const on = { onSuccess: refresh };
  return {
    create: useMutation({ mutationFn: async (body: Partial<Role>) => unwrap(await api.POST('/roles', { body: body as Role })), ...on }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: Partial<Role> & { id: string }) => unwrap(await api.PATCH('/roles/{id}', { params: { path: { id } }, body: body as Role })),
      ...on,
    }),
    remove: useMutation({ mutationFn: async (id: string) => unwrap(await api.DELETE('/roles/{id}', { params: { path: { id } } })), ...on }),
  };
}
