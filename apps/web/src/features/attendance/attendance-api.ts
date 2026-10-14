'use client';

import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, idempotencyKey, unwrap } from '@/core/api';

export type AttendanceRecord = Schemas['AttendanceRecord'];
export type DayStatus = AttendanceRecord['status'];
export type LeaveRequest = Schemas['LeaveRequest'];
export type Policy = Schemas['AttendancePolicy'];

export const DAY_STATUS_LABEL: Record<DayStatus, string> = { present: 'Present', late: 'Late', absent: 'Absent', leave: 'Leave', half_day: 'Half day', wfh: 'Work from home' };
export const DAY_STATUS_TONE: Record<DayStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary'> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  leave: 'info',
  half_day: 'neutral',
  wfh: 'primary',
};
export const LEAVE_TONE: Record<LeaveRequest['status'], 'warning' | 'success' | 'danger' | 'neutral'> = { pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'neutral' };

/** YYYY-MM-DD in the browser's (company) time zone. */
export const todayLocal = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA');

export function useRecords(filters: { userId?: string; from?: string; to?: string; status?: DayStatus }, enabled = true) {
  return useQuery({
    queryKey: ['attendance-records', filters],
    enabled,
    queryFn: async () => unwrap(await api.GET('/attendance/records', { params: { query: { limit: 200, ...filters } } })).data,
  });
}

export function useDefaultPolicy() {
  return useQuery({
    queryKey: ['attendance-policies'],
    queryFn: async () => unwrap(await api.GET('/attendance-policies', { params: { query: { limit: 100 } } })).data,
    select: (list) => ({ all: list, default: list.find((p) => p.isDefault) }),
  });
}

export function useLeaveTypes() {
  return useQuery({ queryKey: ['leave-types'], queryFn: async () => unwrap(await api.GET('/leave-types', { params: { query: { limit: 100 } } })).data });
}

export function useHolidays() {
  return useQuery({ queryKey: ['holidays'], queryFn: async () => unwrap(await api.GET('/holidays', { params: { query: { limit: 200 } } })).data });
}

export function useLeaveRequests(filters: { userId?: string; status?: LeaveRequest['status'] }) {
  return useQuery({ queryKey: ['leave-requests', filters], queryFn: async () => unwrap(await api.GET('/leave-requests', { params: { query: { limit: 100, ...filters } } })).data });
}

export function useCorrections(enabled: boolean) {
  return useQuery({
    queryKey: ['attendance-corrections'],
    enabled,
    queryFn: async () => unwrap(await api.GET('/attendance/corrections', { params: { query: { limit: 100, status: 'pending' } } })).data,
  });
}

export function useAttendanceActions() {
  const qc = useQueryClient();
  const refresh = () => {
    for (const k of ['attendance-records', 'leave-requests', 'attendance-corrections', 'attendance-policies', 'leave-types', 'holidays']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const m = <A, R>(fn: (a: A) => Promise<R>) => useMutation({ mutationFn: fn, onSuccess: refresh });
  return {
    checkIn: m(async (body: Schemas['CheckIn']) => unwrap(await api.POST('/attendance/check-in', { body }))),
    checkOut: m(async (body: Schemas['CheckIn']) => unwrap(await api.POST('/attendance/check-out', { body }))),
    requestCorrection: m(async ({ id, ...body }: { id: string; requestedStatus: DayStatus; requestedCheckInAt?: string; requestedCheckOutAt?: string; reason: string }) =>
      unwrap(await api.POST('/attendance/records/{id}/corrections', { params: { path: { id } }, body: body as Schemas['AttendanceCorrection'] })),
    ),
    reviewCorrection: m(async ({ id, decision, note }: { id: string; decision: 'approve' | 'reject'; note?: string }) =>
      unwrap(await api.POST('/attendance/corrections/{id}/review', { params: { path: { id } }, body: { decision, ...(note ? { note } : {}) } })),
    ),
    requestLeave: m(async (body: { leaveTypeId: string; startDate: string; endDate: string; isHalfDay?: boolean; reason?: string }) =>
      unwrap(await api.POST('/leave-requests', { body: body as LeaveRequest })),
    ),
    reviewLeave: m(async ({ id, decision, note }: { id: string; decision: 'approve' | 'reject'; note?: string }) =>
      unwrap(await api.POST('/leave-requests/{id}/review', { params: { path: { id } }, body: { decision, ...(note ? { note } : {}) } })),
    ),
    cancelLeave: m(async (id: string) => unwrap(await api.POST('/leave-requests/{id}/cancel', { params: { path: { id } } }))),
    savePolicy: m(async ({ id, ...body }: Partial<Policy> & { id?: string }) =>
      id
        ? unwrap(await api.PATCH('/attendance-policies/{id}', { params: { path: { id } }, body: body as Policy }))
        : unwrap(await api.POST('/attendance-policies', { params: { header: { 'Idempotency-Key': idempotencyKey() } }, body: body as Policy })),
    ),
    addHoliday: m(async (body: { holidayDate: string; name: string }) =>
      unwrap(await api.POST('/holidays', { params: { header: { 'Idempotency-Key': idempotencyKey() } }, body: body as Schemas['Holiday'] })),
    ),
    removeHoliday: m(async (id: string) => unwrap(await api.DELETE('/holidays/{id}', { params: { path: { id } } }))),
    saveLeaveType: m(async ({ id, ...body }: Partial<Schemas['LeaveType']> & { id?: string }) =>
      id
        ? unwrap(await api.PATCH('/leave-types/{id}', { params: { path: { id } }, body: body as Schemas['LeaveType'] }))
        : unwrap(await api.POST('/leave-types', { params: { header: { 'Idempotency-Key': idempotencyKey() } }, body: body as Schemas['LeaveType'] })),
    ),
  };
}

/** The device location, when the user allows it. */
export function currentPosition(): Promise<{ latitude: number; longitude: number } | undefined> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(undefined),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}
