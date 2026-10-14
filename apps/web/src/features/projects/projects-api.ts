'use client';

import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, idempotencyKey, unwrap } from '@/core/api';

export type Developer = Schemas['Developer'];
export type Project = Schemas['Project'];
export type Building = Schemas['Building'];
export type Unit = Schemas['Unit'];
export type UnitStatus = Unit['status'];

export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = { available: 'Available', on_hold: 'On hold', booked: 'Booked', sold: 'Sold' };
export const UNIT_STATUS_TONE: Record<UnitStatus, 'success' | 'warning' | 'info' | 'neutral'> = { available: 'success', on_hold: 'warning', booked: 'info', sold: 'neutral' };
export const PROPERTY_TYPE_LABEL: Record<Unit['propertyType'], string> = {
  apartment: 'Apartment',
  villa: 'Villa',
  townhouse: 'Townhouse',
  penthouse: 'Penthouse',
  duplex: 'Duplex',
  office: 'Office',
  retail: 'Retail',
  plot: 'Plot',
};
export const CONSTRUCTION_LABEL: Record<Project['constructionStatus'], string> = { off_plan: 'Off-plan', under_construction: 'Under construction', ready: 'Ready' };

export function useDevelopers() {
  return useQuery({ queryKey: ['developers'], staleTime: 60_000, queryFn: async () => unwrap(await api.GET('/developers', { params: { query: { limit: 200 } } })).data });
}

export function useProjects(filters: { developerId?: string; q?: string; isActive?: boolean } = {}) {
  return useQuery({
    queryKey: ['projects', filters],
    queryFn: async () => unwrap(await api.GET('/projects', { params: { query: { limit: 200, ...filters } } })).data,
  });
}

export function useProject(id: string) {
  return useQuery({ queryKey: ['projects', id], queryFn: async () => unwrap(await api.GET('/projects/{id}', { params: { path: { id } } })) });
}

export function useBuildings(projectId: string) {
  return useQuery({ queryKey: ['projects', projectId, 'buildings'], queryFn: async () => unwrap(await api.GET('/projects/{id}/buildings', { params: { path: { id: projectId } } })).data ?? [] });
}

export type UnitFilters = { buildingId?: string; propertyType?: Unit['propertyType']; bedrooms?: number; priceMin?: string; priceMax?: string; status?: UnitStatus };

export function useUnits(projectId: string, filters: UnitFilters) {
  return useQuery({
    queryKey: ['units', projectId, filters],
    queryFn: async () => unwrap(await api.GET('/units', { params: { query: { projectId, limit: 200, ...filters } } })),
  });
}

export function useUnitHistory(unitId: string | null) {
  return useQuery({
    queryKey: ['units', unitId, 'history'],
    enabled: !!unitId,
    queryFn: async () => unwrap(await api.GET('/units/{id}/history', { params: { path: { id: unitId! } } })).data ?? [],
  });
}

export function useUnitFiles(unitId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['units', unitId, 'attachments'],
    enabled: !!unitId && enabled,
    queryFn: async () => unwrap(await api.GET('/units/{id}/attachments', { params: { path: { id: unitId! } } })).data ?? [],
  });
}

/** Every change to projects and units refreshes the lists, inventory and history. */
export function useProjectActions() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['projects'] });
    void qc.invalidateQueries({ queryKey: ['units'] });
    void qc.invalidateQueries({ queryKey: ['developers'] });
  };
  const m = <A, R>(fn: (a: A) => Promise<R>) => useMutation({ mutationFn: fn, onSuccess: refresh });
  return {
    createDeveloper: m(async (body: Partial<Developer>) => unwrap(await api.POST('/developers', { params: { header: { 'Idempotency-Key': idempotencyKey() } }, body: body as Developer }))),
    createProject: m(async (body: Partial<Project>) => unwrap(await api.POST('/projects', { params: { header: { 'Idempotency-Key': idempotencyKey() } }, body: body as Project }))),
    updateProject: m(async ({ id, ...body }: Partial<Project> & { id: string }) => unwrap(await api.PATCH('/projects/{id}', { params: { path: { id } }, body: body as Project }))),
    createBuilding: m(async ({ projectId, ...body }: Partial<Building> & { projectId: string }) => unwrap(await api.POST('/projects/{id}/buildings', { params: { path: { id: projectId } }, body: body as Building }))),
    createUnit: m(async (body: Partial<Unit>) => unwrap(await api.POST('/units', { body: body as Unit }))),
    updateUnit: m(async ({ id, ...body }: Partial<Unit> & { id: string }) => unwrap(await api.PATCH('/units/{id}', { params: { path: { id } }, body: body as Unit }))),
    changeStatus: m(async ({ id, ...body }: Schemas['UnitStatusChange'] & { id: string }) => unwrap(await api.POST('/units/{id}/status', { params: { path: { id } }, body }))),
    attachToUnit: m(async ({ id, fileId, category }: { id: string; fileId: string; category: Schemas['Attachment']['category'] }) =>
      unwrap(await api.POST('/units/{id}/attachments', { params: { path: { id } }, body: { fileId, category } })),
    ),
    attachToProject: m(async ({ id, fileId, category }: { id: string; fileId: string; category: Schemas['Attachment']['category'] }) =>
      unwrap(await api.POST('/projects/{id}/attachments', { params: { path: { id } }, body: { fileId, category } })),
    ),
  };
}

export function formatPrice(price: string | number, currency = 'AED'): string {
  return `${currency} ${Number(price).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
