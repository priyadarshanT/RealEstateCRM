import * as React from 'react';
import { cn } from '../lib/cn';

export interface TabItem {
  key: string;
  label: React.ReactNode;
  count?: number;
}

/** Underlined tab strip. Controlled: the parent owns the selected key. */
export function TabStrip({ items, value, onChange, className }: { items: TabItem[]; value: string; onChange: (key: string) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('flex flex-wrap gap-x-1 border-b border-border', className)}>
      {items.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm',
              active ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {t.count !== undefined ? <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary">{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
