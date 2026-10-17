'use client';

import { Button, Field, Input, Popover, PopoverContent, PopoverTrigger, Select, cn } from '@crm/ui';
import { CalendarDays, X } from 'lucide-react';
import { useState } from 'react';
import { ymd } from '@/core/date-range';

// Calendar / Date Range (Lead and Project pages): a date field, presets or a custom start and end date, Apply and
// Clear. Dates are calendar days; the API applies them in the company time zone with the end date included.

export interface DateRangeValue {
  field: string;
  from?: string;
  to?: string;
}

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 Days' },
  { key: 'thisMonth', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' },
] as const;

function presetDates(key: (typeof PRESETS)[number]['key'], now = new Date()): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const day = (yy: number, mm: number, dd: number) => ymd(new Date(yy, mm, dd));
  switch (key) {
    case 'today':
      return { from: day(y, m, d), to: day(y, m, d) };
    case 'yesterday':
      return { from: day(y, m, d - 1), to: day(y, m, d - 1) };
    case 'last7':
      return { from: day(y, m, d - 6), to: day(y, m, d) };
    case 'thisMonth':
      return { from: day(y, m, 1), to: day(y, m, d) };
    case 'lastMonth':
      return { from: day(y, m - 1, 1), to: day(y, m, 0) };
  }
}

const short = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function DateRangeControl({
  fields,
  value,
  onChange,
}: {
  fields: { key: string; label: string }[];
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRangeValue>(value);
  const fieldLabel = fields.find((f) => f.key === value.field)?.label ?? fields[0]?.label;
  const active = !!(value.from || value.to);
  const invalid = !!(draft.from && draft.to && draft.to < draft.from);

  return (
    <div className="flex items-center gap-1">
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setDraft(value);
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn(active && 'border-primary text-primary')}>
            <CalendarDays />
            {active ? (
              <span>
                {fieldLabel}: {value.from ? short(value.from) : '…'} – {value.to ? short(value.to) : '…'}
              </span>
            ) : (
              'Calendar / Date Range'
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-3">
          <Field label="Date">
            <Select value={draft.field} onChange={(e) => setDraft({ ...draft, field: e.target.value })}>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className="rounded-full border border-border px-2.5 py-1 text-xs hover:border-primary hover:text-primary"
                onClick={() => setDraft({ ...draft, ...presetDates(p.key) })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start date">
              <Input type="date" value={draft.from ?? ''} onChange={(e) => setDraft({ ...draft, from: e.target.value || undefined })} />
            </Field>
            <Field label="End date (included)" error={invalid ? 'Before the start date' : undefined}>
              <Input type="date" value={draft.to ?? ''} onChange={(e) => setDraft({ ...draft, to: e.target.value || undefined })} />
            </Field>
          </div>
          <div className="flex justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onChange({ field: draft.field });
                setOpen(false);
              }}
            >
              Clear
            </Button>
            <Button
              size="sm"
              disabled={invalid || (!draft.from && !draft.to)}
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {active ? (
        <button type="button" aria-label="Clear date range" className="rounded p-1 text-muted-foreground hover:text-foreground" onClick={() => onChange({ field: value.field })}>
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
