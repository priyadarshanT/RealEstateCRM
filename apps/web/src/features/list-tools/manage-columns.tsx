'use client';

import { Alert, Button, Dialog, DialogContent, Input, cn } from '@crm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Columns3, GripVertical } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';

// Manage Columns (Lead and Project pages): show or hide columns with a searchable checklist, drag them into order,
// Apply / Cancel / Reset to Default. The choice is saved for each user on the server.

export interface ColumnOption {
  key: string;
  label: string;
  /** Always shown (e.g. the name). */
  locked?: boolean;
}

/** The user's saved columns for a list (default when nothing is saved), and save / reset. */
export function useListColumns(list: 'leads' | 'projects', all: ColumnOption[], defaults: string[]) {
  const qc = useQueryClient();
  const saved = useQuery({
    queryKey: ['list-columns', list],
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await api.GET('/me/list-columns/{list}', { params: { path: { list } } })).columns,
  });
  const known = new Set(all.map((c) => c.key));
  const columns = (saved.data ?? defaults).filter((k) => known.has(k));
  const save = useMutation({
    mutationFn: async (keys: string[]) => unwrap(await api.PUT('/me/list-columns/{list}', { params: { path: { list } }, body: { columns: keys } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['list-columns', list] }),
  });
  const reset = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/me/list-columns/{list}', { params: { path: { list } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['list-columns', list] }),
  });
  return { columns: columns.length ? columns : defaults, loading: saved.isLoading, save, reset };
}

export function ManageColumnsButton({
  all,
  value,
  defaults,
  onApply,
  onReset,
  error,
}: {
  all: ColumnOption[];
  value: string[];
  defaults: string[];
  onApply: (keys: string[]) => Promise<unknown>;
  onReset: () => Promise<unknown>;
  error?: unknown;
}) {
  const [open, setOpen] = useState(false);
  // Order: chosen columns first in their order, then the rest.
  const [order, setOrder] = useState<string[]>([]);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = new Map(all.map((c) => [c.key, c]));

  const start = () => {
    setOrder([...value, ...all.map((c) => c.key).filter((k) => !value.includes(k))]);
    setShown(new Set(value));
    setQ('');
    setOpen(true);
  };
  const move = (key: string, to: number) =>
    setOrder((o) => {
      const rest = o.filter((k) => k !== key);
      rest.splice(Math.max(0, Math.min(to, rest.length)), 0, key);
      return rest;
    });
  const visible = order.filter((k) => !q.trim() || label.get(k)?.label.toLowerCase().includes(q.trim().toLowerCase()));

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      setOpen(false);
    } catch {
      /* the error is shown below */
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={start}>
        <Columns3 /> Manage Columns
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Manage Columns">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Tick the columns to show and drag them into order. Saved for you only.</p>
            <Input placeholder="Search columns" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search columns" />
            <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {visible.map((key) => {
                const c = label.get(key)!;
                const i = order.indexOf(key);
                return (
                  <li
                    key={key}
                    draggable
                    onDragStart={() => setDragging(key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragging && dragging !== key) move(dragging, order.indexOf(key));
                      setDragging(null);
                    }}
                    className={cn('flex items-center gap-2 bg-surface px-2 py-1.5 text-sm', dragging === key && 'opacity-50')}
                  >
                    <GripVertical className="size-4 cursor-grab text-muted-foreground" aria-hidden />
                    <label className="flex flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={shown.has(key) || !!c.locked}
                        disabled={c.locked}
                        onChange={(e) =>
                          setShown((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(key);
                            else n.delete(key);
                            return n;
                          })
                        }
                      />
                      {c.label}
                    </label>
                    <button type="button" aria-label={`Move ${c.label} up`} disabled={i === 0} onClick={() => move(key, i - 1)} className="p-0.5 text-muted-foreground disabled:opacity-30">
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button type="button" aria-label={`Move ${c.label} down`} disabled={i === order.length - 1} onClick={() => move(key, i + 1)} className="p-0.5 text-muted-foreground disabled:opacity-30">
                      <ArrowDown className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {error ? <Alert>{errorMessage(error)}</Alert> : null}
            <div className="flex justify-between gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void run(onReset)}>
                Reset to Default
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void run(() => onApply(order.filter((k) => shown.has(k) || label.get(k)?.locked)))}
                >
                  Apply
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Default: {defaults.map((k) => label.get(k)?.label).join(', ')}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
