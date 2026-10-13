// Date ranges for the day, week and month views of Tasks & Calendar.

import { ymd } from '@/core/date-range';

export type CalendarView = 'day' | 'week' | 'month' | 'list';

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Week starts on Sunday (UAE working week Sunday–Thursday in the wireframe). */
export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -d.getDay());
}

export function rangeFor(view: CalendarView, anchor: Date): { from: Date; to: Date; days: Date[] } {
  if (view === 'day') {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1), days: [from] };
  }
  if (view === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7), days: Array.from({ length: 7 }, (_, i) => addDays(from, i)) };
  }
  if (view === 'month') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const from = startOfWeek(first);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const to = addDays(startOfWeek(last), 7);
    const n = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    return { from, to, days: Array.from({ length: n }, (_, i) => addDays(from, i)) };
  }
  // List: the next 30 days from today.
  const from = startOfDay(anchor);
  return { from, to: addDays(from, 30), days: [] };
}

/**
 * GET /tasks takes `from`/`to` as UTC dates (YYYY-MM-DD, `to` inclusive). Local days can cross UTC midnight
 * (Dubai is UTC+4), so we ask for one extra day on each side and place tasks by their local day on screen.
 */
export function apiDateRange(from: Date, to: Date): { from: string; to: string } {
  return { from: ymd(addDays(from, -1)), to: ymd(to) };
}

export function shift(view: CalendarView, anchor: Date, dir: 1 | -1): Date {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week' || view === 'list') return addDays(anchor, 7 * dir);
  return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
