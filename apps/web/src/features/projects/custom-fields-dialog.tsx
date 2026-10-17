'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Field, Input, Select } from '@crm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import type { CustomField } from './project-columns';

const TYPE_LABEL: Record<CustomField['fieldType'], string> = { text: 'Text', number: 'Number', date: 'Date', dropdown: 'Dropdown', checkbox: 'Checkbox' };

export function useCustomFields() {
  return useQuery({ queryKey: ['project-custom-fields'], staleTime: 60_000, queryFn: async () => unwrap(await api.GET('/project-custom-fields')).data });
}

/**
 * Add Custom Field (Project page §2.7–2.8, Admin only): name, type, required and dropdown choices. New fields appear
 * in the project form, Manage Columns and exports. Turning a field off keeps the values on old projects.
 */
export function CustomFieldsButton() {
  const qc = useQueryClient();
  const fields = useCustomFields();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState<CustomField['fieldType']>('text');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['project-custom-fields'] });
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/project-custom-fields', {
          body: { label: label.trim(), fieldType, isRequired: required, ...(fieldType === 'dropdown' ? { options: options.split(',').map((o) => o.trim()).filter(Boolean) } : {}) },
        }),
      ),
    onSuccess: () => {
      setLabel('');
      setOptions('');
      setRequired(false);
      void refresh();
    },
  });
  const update = useMutation({
    mutationFn: async ({ id, ...body }: { id: string; isActive?: boolean; isRequired?: boolean }) => unwrap(await api.PATCH('/project-custom-fields/{id}', { params: { path: { id } }, body })),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE('/project-custom-fields/{id}', { params: { path: { id } } })),
    onSuccess: refresh,
  });
  const error = create.error ?? update.error ?? remove.error;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <SlidersHorizontal /> Custom Fields
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Custom project fields" wide>
          <div className="space-y-4">
            <ul className="divide-y divide-border rounded-lg border border-border">
              {(fields.data ?? []).map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-medium">{f.label}</span>
                  <Badge tone="neutral">{TYPE_LABEL[f.fieldType]}</Badge>
                  {f.fieldType === 'dropdown' ? <span className="text-xs text-muted-foreground">{f.options.join(', ')}</span> : null}
                  <span className="ml-auto flex items-center gap-3 text-xs">
                    <label className="inline-flex items-center gap-1">
                      <input type="checkbox" checked={f.isRequired} onChange={(e) => update.mutate({ id: f.id, isRequired: e.target.checked })} /> Required
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input type="checkbox" checked={f.isActive} onChange={(e) => update.mutate({ id: f.id, isActive: e.target.checked })} /> Active
                    </label>
                    <button type="button" aria-label={`Delete ${f.label}`} className="text-muted-foreground hover:text-danger" onClick={() => window.confirm(`Delete the field "${f.label}"? Values stay on projects but are no longer shown.`) && remove.mutate(f.id)}>
                      <Trash2 className="size-4" />
                    </button>
                  </span>
                </li>
              ))}
              {fields.data?.length === 0 ? <li className="px-3 py-3 text-sm text-muted-foreground">No custom fields yet.</li> : null}
            </ul>
            <form
              className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                if (label.trim()) create.mutate();
              }}
            >
              <Field label="Field name">
                <Input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Plot size" />
              </Field>
              <Field label="Type">
                <Select value={fieldType} onChange={(e) => setFieldType(e.target.value as CustomField['fieldType'])}>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="flex items-end gap-1.5 pb-2 text-sm">
                <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
              </label>
              {fieldType === 'dropdown' ? (
                <Field label="Choices (comma separated)" className="sm:col-span-3">
                  <Input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Freehold, Leasehold" />
                </Field>
              ) : null}
              <div className="flex justify-end sm:col-span-3">
                <Button type="submit" disabled={!label.trim() || create.isPending || (fieldType === 'dropdown' && !options.trim())}>
                  <Plus /> Add Custom Field
                </Button>
              </div>
            </form>
            {error ? <Alert>{errorMessage(error)}</Alert> : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
