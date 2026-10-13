import { cn } from '@crm/ui';
import { CalendarCheck, Home, ListTodo, Phone, RotateCw } from 'lucide-react';
import { formatTime } from '@/core/format';
import type { Task } from './tasks-api';

const STYLE: Record<Task['type'], string> = {
  call: 'border-l-info bg-info/10',
  follow_up: 'border-l-primary bg-primary/10',
  meeting: 'border-l-violet-500 bg-violet-100',
  viewing: 'border-l-amber-500 bg-amber-100',
  personal: 'border-l-slate-400 bg-slate-100',
};

const ICON = { call: Phone, follow_up: RotateCw, meeting: CalendarCheck, viewing: Home, personal: ListTodo } as const;

/** One task in the calendar. Overdue items are red, done items are struck through (wireframe "Tasks and calendar"). */
export function TaskChip({ task, timeZone, onClick }: { task: Task; timeZone?: string; onClick: () => void }) {
  const Icon = ICON[task.type];
  const overdue = task.status === 'open' && Date.parse(task.dueAt) < Date.now();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'block w-full rounded border-l-4 px-1.5 py-1 text-left text-xs',
        STYLE[task.type],
        overdue && 'border-l-danger bg-danger/10',
        task.status === 'completed' && 'border-l-success bg-success/10 text-muted-foreground line-through',
        task.status === 'cancelled' && 'opacity-50 line-through',
      )}
    >
      <span className="block text-[11px] text-muted-foreground no-underline">{formatTime(task.dueAt, timeZone)}</span>
      <span className="flex items-center gap-1">
        <Icon className="size-3 shrink-0" />
        <span className="truncate">{task.title}</span>
      </span>
    </button>
  );
}
