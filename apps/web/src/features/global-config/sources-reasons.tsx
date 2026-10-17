'use client';

import { Alert, Button, Card, CardBody, CardHeader, Input, Table, Td, Th, Tr } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { useReasons, useSources } from '@/core/lookups';

type Reason = Schemas['Reason'];
type Source = Schemas['LeadSource'];

function useInvalidate(key: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [key] });
}

/** Reasons asked for when a lead is reassigned (SRS §4.10). Built-in ones are used by automation and cannot be deleted. */
export function ReasonsCard() {
  const reasons = useReasons('reassignment');
  const refresh = useInvalidate('reasons');
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: async ({ id, ...body }: Partial<Reason> & { id: string }) => unwrap(await api.PATCH('/reasons/{id}', { params: { path: { id } }, body: body as Reason })),
    onSuccess: refresh,
  });
  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST('/reasons', { body: { name: name.trim(), type: 'reassignment' } as Reason })),
    onSuccess: () => {
      setName('');
      void refresh();
    },
  });
  const remove = useMutation({ mutationFn: async (id: string) => unwrap(await api.DELETE('/reasons/{id}', { params: { path: { id } } })), onSuccess: refresh });

  return (
    <Card>
      <CardHeader title="Reassignment reasons" />
      <CardBody className="space-y-3">
        <Table>
          <thead>
            <tr>
              <Th>Reason</Th>
              <Th>Active</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {(reasons.data ?? []).map((r) => (
              <Tr key={r.id}>
                <Td>
                  <InlineName value={r.name} onSave={(n) => save.mutate({ id: r.id, name: n })} />
                </Td>
                <Td>
                  <input type="checkbox" checked={r.isActive !== false} onChange={(e) => save.mutate({ id: r.id, isActive: e.target.checked })} aria-label={`${r.name} active`} />
                </Td>
                <Td>
                  {!r.key ? (
                    <Button variant="link" size="sm" className="text-danger" onClick={() => remove.mutate(r.id)}>
                      Delete
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input className="h-8 w-48 text-xs" placeholder="New reason" value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" type="submit" disabled={!name.trim() || create.isPending}>
            Add reason
          </Button>
        </form>
        {save.error || create.error || remove.error ? <Alert>{errorMessage(save.error ?? create.error ?? remove.error)}</Alert> : null}
      </CardBody>
    </Card>
  );
}

/** Lead sources with a quality score used by lead scoring (Global Configuration › Manage Source). */
export function SourcesCard() {
  const sources = useSources();
  const refresh = useInvalidate('lead-sources');
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: async ({ id, ...body }: Partial<Source> & { id: string }) =>
      unwrap(await api.PATCH('/lead-sources/{id}', { params: { path: { id } }, body: body as Source })),
    onSuccess: refresh,
  });
  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST('/lead-sources', { body: { name: name.trim(), type: 'other' } as Source })),
    onSuccess: () => {
      setName('');
      void refresh();
    },
  });

  return (
    <Card>
      <CardHeader title="Lead sources" />
      <CardBody className="space-y-3">
        <Table>
          <thead>
            <tr>
              <Th>Source</Th>
              <Th>Type</Th>
              <Th>Quality (0–100)</Th>
              <Th>Active</Th>
            </tr>
          </thead>
          <tbody>
            {(sources.data ?? []).map((s) => (
              <Tr key={s.id}>
                <Td>
                  <InlineName value={s.name} onSave={(n) => save.mutate({ id: s.id, name: n })} />
                </Td>
                <Td className="text-xs text-muted-foreground">{s.type}</Td>
                <Td>
                  <Input
                    className="h-7 w-20 text-xs"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={s.qualityScore ?? 50}
                    onBlur={(e) => Number(e.target.value) !== s.qualityScore && save.mutate({ id: s.id, qualityScore: Number(e.target.value) })}
                    aria-label={`${s.name} quality`}
                  />
                </Td>
                <Td>
                  <input type="checkbox" checked={s.isActive !== false} onChange={(e) => save.mutate({ id: s.id, isActive: e.target.checked })} aria-label={`${s.name} active`} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input className="h-8 w-48 text-xs" placeholder="New source, e.g. Referral partner" value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" type="submit" disabled={!name.trim() || create.isPending}>
            Add source
          </Button>
        </form>
        {save.error || create.error ? <Alert>{errorMessage(save.error ?? create.error)}</Alert> : null}
      </CardBody>
    </Card>
  );
}

/** Click-to-rename text. Saves on Enter or when focus leaves. */
export function InlineName({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  if (!editing)
    return (
      <button type="button" className="text-left hover:underline" onClick={() => (setText(value), setEditing(true))}>
        {value}
      </button>
    );
  const commit = () => {
    setEditing(false);
    if (text.trim() && text.trim() !== value) onSave(text.trim());
  };
  return (
    <Input
      autoFocus
      className="h-7 text-sm"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}
