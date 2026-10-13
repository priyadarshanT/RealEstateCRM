import { AlertTriangle, Loader2 } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted-foreground', className)} />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Spinner /> {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}

const alertTones = {
  danger: 'border-danger/30 bg-danger/5 text-danger',
  warning: 'border-warning/40 bg-warning/10 text-foreground',
  info: 'border-info/30 bg-info/5 text-foreground',
  success: 'border-success/30 bg-success/5 text-foreground',
} as const;

export function Alert({ tone = 'danger', children, className }: { tone?: keyof typeof alertTones; children: React.ReactNode; className?: string }) {
  return (
    <div role={tone === 'danger' ? 'alert' : undefined} className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', alertTones[tone], className)}>
      {tone === 'danger' || tone === 'warning' ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : null}
      <div>{children}</div>
    </div>
  );
}

/** Small number card used on the dashboard. Clickable when it opens the records behind it. */
export function StatCard({ label, value, accent, onClick }: { label: string; value: React.ReactNode; accent?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex flex-col items-start rounded-lg border border-t-4 border-border bg-surface px-3 py-2.5 text-left enabled:hover:bg-muted/50 disabled:cursor-default"
      style={accent ? { borderTopColor: accent } : undefined}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </button>
  );
}
