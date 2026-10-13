'use client';

import { Button, Popover, PopoverContent, PopoverTrigger, cn } from '@crm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api, unwrap } from '@/core/api';
import { formatDateTime } from '@/core/format';

/** Re-enquiries, reassignments, overdue follow-ups and reminders (GET /notifications). */
export function NotificationsBell() {
  const qc = useQueryClient();
  const router = useRouter();
  const list = useQuery({
    queryKey: ['notifications'],
    refetchInterval: 60_000,
    queryFn: async () => unwrap(await api.GET('/notifications', { params: { query: { limit: 20 } } })).data,
  });
  const unread = (list.data ?? []).filter((n) => !n.readAt).length;

  const markRead = useMutation({
    mutationFn: async (id: string) => unwrap(await api.POST('/notifications/{id}/read', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAll = useMutation({
    mutationFn: async () => unwrap(await api.POST('/notifications/read-all')),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <Popover>
      <PopoverTrigger className="flex h-8 items-center gap-1 rounded-md border border-border px-2 text-sm" aria-label="Notifications">
        <Bell className="size-4" />
        {unread ? <span className="font-semibold">{unread}</span> : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread ? (
            <Button variant="link" size="sm" onClick={() => markAll.mutate()}>
              Mark all read
            </Button>
          ) : null}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {(list.data ?? []).length === 0 ? <p className="p-3 text-sm text-muted-foreground">Nothing new.</p> : null}
          {(list.data ?? []).map((n) => (
            <button
              key={n.id}
              className={cn('block w-full border-b border-border px-3 py-2 text-left hover:bg-muted', !n.readAt && 'bg-primary/5')}
              onClick={() => {
                if (!n.readAt) markRead.mutate(n.id);
                if (n.leadId) router.push(`/leads/${n.leadId}`);
                else if (n.linkPath) router.push(n.linkPath);
              }}
            >
              <p className="text-sm font-medium">{n.title}</p>
              {n.body ? <p className="text-xs text-muted-foreground">{n.body}</p> : null}
              <p className="text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</p>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
