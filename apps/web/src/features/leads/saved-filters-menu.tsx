'use client';

import { Button, Dialog, DialogContent, Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger, Field, Input } from '@crm/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { useSavedFilters } from './leads-api';

export interface SavedView {
  filters: Record<string, unknown>;
  columns: string[];
}

/** Saved filters (SRS §1.4): store the current tab, filters and columns by name, and apply them later. */
export function SavedFiltersMenu({ current, activeName, onApply }: { current: SavedView; activeName: string | null; onApply: (name: string, v: SavedView) => void }) {
  const qc = useQueryClient();
  const saved = useSavedFilters();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const save = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/saved-filters', { body: { entity: 'leads', name: name.trim(), filters: current.filters, columns: current.columns } as never })),
    onSuccess: (f) => {
      void qc.invalidateQueries({ queryKey: ['saved-filters'] });
      setNaming(false);
      setName('');
      onApply(f.name, { filters: f.filters as Record<string, unknown>, columns: f.columns ?? current.columns });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE('/saved-filters/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-filters'] }),
  });

  return (
    <>
      <Dropdown>
        <DropdownTrigger asChild>
          <Button variant="outline" size="sm" className={activeName ? 'border-amber-300 bg-amber-50' : undefined}>
            <Star className={activeName ? 'fill-amber-400 text-amber-500' : undefined} />
            {activeName ? `Saved: ${activeName}` : 'Saved filters'}
            <ChevronDown />
          </Button>
        </DropdownTrigger>
        <DropdownContent>
          {(saved.data ?? []).length === 0 ? <p className="px-2 py-1.5 text-sm text-muted-foreground">No saved filters yet.</p> : null}
          {saved.data?.map((f) => (
            <DropdownItem key={f.id} onSelect={() => onApply(f.name, { filters: f.filters as Record<string, unknown>, columns: f.columns ?? [] })}>
              <span className="flex-1">{f.name}</span>
              <button
                type="button"
                aria-label={`Delete ${f.name}`}
                className="rounded p-0.5 text-muted-foreground hover:text-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  remove.mutate(f.id);
                }}
              >
                <Trash2 className="size-3.5" />
              </button>
            </DropdownItem>
          ))}
          <DropdownSeparator />
          <DropdownItem onSelect={() => setNaming(true)}>Save current filters…</DropdownItem>
        </DropdownContent>
      </Dropdown>

      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent title="Save filters">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) save.mutate();
            }}
          >
            <Field label="Name" error={save.error ? errorMessage(save.error) : undefined}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hot this week" autoFocus />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setNaming(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || save.isPending}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
