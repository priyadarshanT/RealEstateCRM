'use client';

import { cn } from '@crm/ui';
import { AlarmClock, Inbox, RotateCw } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatDateTime, formatMoney, formatRelativeDay, initials } from '@/core/format';

export interface GridColumn {
  key: string;
  label: string;
  type?: string;
}

const NUMERIC = new Set(['number', 'money', 'percent']);

/** Stage colours by stage name: early (blue), working (amber), late (violet), won (green), lost / invalid (red / grey). */
const STAGE_TONE: Record<string, string> = {
  New: 'bg-sky-50 text-sky-700 ring-sky-200',
  Pending: 'bg-sky-50 text-sky-700 ring-sky-200',
  Attempted: 'bg-amber-50 text-amber-700 ring-amber-200',
  'No Response': 'bg-orange-50 text-orange-700 ring-orange-200',
  'Follow-up': 'bg-amber-50 text-amber-700 ring-amber-200',
  Warm: 'bg-orange-50 text-orange-700 ring-orange-200',
  Hot: 'bg-rose-50 text-rose-700 ring-rose-200',
  Qualified: 'bg-teal-50 text-teal-700 ring-teal-200',
  'Meeting Scheduled': 'bg-violet-50 text-violet-700 ring-violet-200',
  'Viewing Scheduled': 'bg-violet-50 text-violet-700 ring-violet-200',
  'EOI Submitted': 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  Booked: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  Won: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Lost: 'bg-red-50 text-red-700 ring-red-200',
  Invalid: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const AVATAR_TONES = ['bg-teal-100 text-teal-800', 'bg-sky-100 text-sky-800', 'bg-violet-100 text-violet-800', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-800', 'bg-emerald-100 text-emerald-800', 'bg-indigo-100 text-indigo-800'];

function avatarTone(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', size === 'md' ? 'size-8 text-xs' : 'size-6 text-[10px]', avatarTone(name))}>
      {initials(name)}
    </span>
  );
}

const Muted = ({ children }: { children?: ReactNode }) => <span className="text-muted-foreground/60">{children ?? '—'}</span>;

/**
 * Report results as a readable grid: sticky header, one line per row, colour for stage, priority and score,
 * people with avatars, overdue follow-ups in red, numbers right-aligned. Lead rows open the lead.
 */
export function ReportGrid({
  columns,
  rows,
  totals,
  timeZone,
  loading,
}: {
  columns: GridColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  timeZone?: string;
  loading?: boolean;
}) {
  const now = Date.now();
  const maxOf = new Map(
    columns.filter((c) => c.type === 'percent' || c.key === 'leads').map((c) => [c.key, Math.max(1, ...rows.map((r) => Number(r[c.key] ?? 0)))]),
  );

  const cell = (c: GridColumn, row: Record<string, unknown>, isTotal = false): ReactNode => {
    const v = row[c.key];
    const empty = v === null || v === undefined || v === '';
    if (isTotal) {
      if (empty) return null;
      return c.type === 'money' ? formatMoney(String(v)) : c.type === 'percent' ? `${Number(v).toFixed(1)}%` : typeof v === 'number' ? v.toLocaleString('en-US') : String(v);
    }
    switch (c.key) {
      case 'name': {
        const name = String(v ?? '—');
        const inner = (
          <span className="flex items-center gap-2.5">
            <Avatar name={name} />
            <span className="truncate font-medium text-foreground">{name}</span>
          </span>
        );
        return row.id ? (
          <Link href={`/leads/${String(row.id)}`} className="block max-w-56 hover:[&_span.truncate]:text-primary">
            {inner}
          </Link>
        ) : (
          inner
        );
      }
      case 'agent':
      case 'employee':
        return empty || v === '—' ? (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs italic text-slate-500">Unassigned</span>
        ) : (
          <span className="flex items-center gap-2">
            <Avatar name={String(v)} size="sm" />
            <span className="truncate">{String(v)}</span>
          </span>
        );
      case 'phone':
        return empty ? <Muted /> : <span className="font-mono text-[13px] tabular-nums text-foreground/80">{String(v)}</span>;
      case 'email':
        return empty ? <Muted /> : <span className="block max-w-52 truncate text-muted-foreground">{String(v)}</span>;
      case 'source':
      case 'campaign':
      case 'form':
        return empty || v === '—' ? <Muted /> : <span className="inline-block max-w-48 truncate rounded-md bg-muted px-2 py-0.5 text-xs text-foreground/80">{String(v)}</span>;
      case 'stage':
        return empty ? <Muted /> : <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', STAGE_TONE[String(v)] ?? 'bg-muted text-foreground/80 ring-border')}>{String(v)}</span>;
      case 'priority': {
        const p = String(v ?? '').toLowerCase();
        if (!p) return <Muted />;
        const tone = p === 'high' ? 'bg-red-500' : p === 'medium' ? 'bg-amber-400' : 'bg-slate-300';
        return (
          <span className="inline-flex items-center gap-1.5 capitalize">
            <span className={cn('size-2 rounded-full', tone)} />
            {p}
          </span>
        );
      }
      case 'score': {
        const s = Number(v ?? 0);
        const tone = s >= 70 ? 'bg-emerald-500' : s >= 40 ? 'bg-amber-400' : 'bg-slate-300';
        return (
          <span className="flex items-center justify-end gap-2">
            <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
              <span className={cn('block h-full rounded-full', tone)} style={{ width: `${Math.min(100, Math.max(0, s))}%` }} />
            </span>
            <span className="w-6 text-right tabular-nums font-medium">{s}</span>
          </span>
        );
      }
      case 'enquiries': {
        const n = Number(v ?? 1);
        return n > 1 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
            <RotateCw className="size-3" /> {n}×
          </span>
        ) : (
          <span className="tabular-nums text-muted-foreground">{n}</span>
        );
      }
      case 'nextFollowUp': {
        if (empty) return <Muted />;
        const late = Date.parse(String(v)) < now;
        return (
          <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', late ? 'font-medium text-red-600' : 'text-foreground/80')}>
            {late ? <AlarmClock className="size-3.5" /> : null}
            {formatRelativeDay(String(v), timeZone)}
          </span>
        );
      }
      case 'createdAt':
        return empty ? <Muted /> : <span className="whitespace-nowrap text-muted-foreground">{formatRelativeDay(String(v), timeZone)}</span>;
      case 'reason':
        return empty || v === '—' ? <Muted /> : <span className="text-red-700/80">{String(v)}</span>;
      default:
        break;
    }
    if (empty) return <Muted />;
    switch (c.type) {
      case 'money':
        return <span className="tabular-nums">{formatMoney(String(v))}</span>;
      case 'percent': {
        const pct = Number(v);
        return (
          <span className="flex items-center justify-end gap-2">
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, (pct / (maxOf.get(c.key) ?? 100)) * 100)}%` }} />
            </span>
            <span className="w-12 text-right tabular-nums">{pct.toFixed(1)}%</span>
          </span>
        );
      }
      case 'number':
        return <span className="tabular-nums">{Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}</span>;
      case 'datetime':
        return <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(String(v), timeZone)}</span>;
      default:
        return <span className="block max-w-64 truncate">{String(v)}</span>;
    }
  };

  const align = (c: GridColumn) => (NUMERIC.has(c.type ?? '') || c.key === 'score' ? 'text-right' : 'text-left');

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition-opacity', loading && 'opacity-60')}>
      <div className="max-h-[calc(100vh-17rem)] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  className={cn(
                    'sticky top-0 z-10 whitespace-nowrap border-b border-border bg-muted/80 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur',
                    align(c),
                    i === 0 && 'left-0 z-20',
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={String(row.id ?? r)} className="group">
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={cn(
                      'whitespace-nowrap border-b border-border/60 px-4 py-2.5 align-middle transition-colors group-hover:bg-primary/[0.04]',
                      r % 2 === 1 ? 'bg-muted/25' : 'bg-surface',
                      align(c),
                      i === 0 && 'sticky left-0 z-[5] shadow-[1px_0_0_0_var(--color-border)]',
                    )}
                  >
                    {cell(c, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals && Object.keys(totals).length && rows.length ? (
            <tfoot>
              <tr>
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={cn('sticky bottom-0 whitespace-nowrap border-t-2 border-primary/20 bg-primary/[0.06] px-4 py-3 font-semibold backdrop-blur', align(c), i === 0 && 'left-0 z-20')}
                  >
                    {i === 0 && totals[c.key] === undefined ? 'Total' : cell(c, totals, true)}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
        {rows.length === 0 && !loading ? (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <Inbox className="size-10 text-muted-foreground/40" />
            <p className="font-medium text-foreground/80">No rows for these filters</p>
            <p className="text-sm">Try a longer period or remove a filter.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
