'use client';

import type { paths, Schemas } from '@crm/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/core/api';

export type Task = Schemas['Task'];
export type TaskQuery = NonNullable<paths['/tasks']['get']['parameters']['query']>;
export type TaskInput = Pick<Task, 'type' | 'title' | 'dueAt' | 'assignedUserId'> & Partial<Pick<Task, 'leadId' | 'description' | 'durationMinutes' | 'reminderMinutes'>>;

export const TASK_TYPE_LABEL: Record<Task['type'], string> = {
  call: 'Call',
  follow_up: 'Follow-up',
  meeting: 'Meeting',
  viewing: 'Viewing',
  personal: 'Task',
};

export const OUTCOMES = [
  { key: 'answered', label: 'Answered' },
  { key: 'no_answer', label: 'No answer' },
  { key: 'busy', label: 'Busy' },
  { key: 'wrong_number', label: 'Wrong number' },
  { key: 'call_back', label: 'Call back' },
] as const;

export type Outcome = (typeof OUTCOMES)[number]['key'];

export function useTasks(query: TaskQuery) {
  return useQuery({
    queryKey: ['tasks', query],
    placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await api.GET('/tasks', { params: { query: { limit: 200, ...query } } })),
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return (leadId?: string | null) => {
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['leads'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    if (leadId) void qc.invalidateQueries({ queryKey: ['lead', leadId] });
  };
}

export function useTaskMutations() {
  const refresh = useRefresh();
  return {
    create: useMutation({
      mutationFn: async (body: TaskInput) => unwrap(await api.POST('/tasks', { body: body as Task })),
      onSuccess: (t) => refresh(t.leadId),
    }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: Partial<TaskInput> & { id: string }) => unwrap(await api.PATCH('/tasks/{id}', { params: { path: { id } }, body: body as Task })),
      onSuccess: (t) => refresh(t.leadId),
    }),
    complete: useMutation({
      mutationFn: async ({ id, ...body }: Schemas['TaskComplete'] & { id: string }) =>
        unwrap(await api.POST('/tasks/{id}/complete', { params: { path: { id } }, body })),
      onSuccess: (r) => refresh(r.task?.leadId),
    }),
    cancel: useMutation({
      mutationFn: async (id: string) => unwrap(await api.POST('/tasks/{id}/cancel', { params: { path: { id } } })),
      onSuccess: (t) => refresh(t.leadId),
    }),
  };
}
