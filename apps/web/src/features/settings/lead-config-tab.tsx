'use client';

import { Alert, Badge, Button, Card, CardBody, CardHeader, Input, Select, Table, Td, Th, Tr } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { useReasons, useSources, useStages } from '@/core/lookups';

type Stage = Schemas['LeadStage'];
type Reason = Schemas['Reason'];
type Source = Schemas['LeadSource'];

/** Stages, reasons and lead sources (SRS §2.19, §2.21, §11.5). Built-in items can be renamed or turned off, not deleted. */
export function LeadConfigTab() {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <StagesCard />
      <div className="space-y-3">
        <ReasonsCard />
        <SourcesCard />
      </div>
    </div>
  );
}

function useInvalidate(key: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [key] });
}

function StagesCard() {
  const stages = useStages();
  const refresh = useInvalidate('lead-stages');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Stage['category']>('open');
  const save = useMutation({
    mutationFn: async ({ id, ...body }: Partial<Stage> & { id: string }) =>
      unwrap(await api.PATCH('/lead-stages/{id}', { params: { path: { id } }, body: body as Stage })),
    onSuccess: refresh,
  });
  const create = useMutation({
    mutationFn: async () => {
      const maxOrder = Math.max(0, ...(stages.data ?? []).map((s) => s.sortOrder));
      return unwrap(await api.POST('/lead-stages', { body: { name: name.trim(), category, sortOrder: maxOrder + 10 } as Stage }));
    },
    onSuccess: () => {
      setName('');
      void refresh();
    },
  });
  const remove = useMutation({ mutationFn: async (id: string) => unwrap(await api.DELETE('/lead-stages/{id}', { params: { path: { id } } })), onSuccess: refresh });

  const list = stages.data ?? [];
  const move = async (i: number, dir: -1 | 1) => {
    const a = list[i];
    const b = list[i + dir];
    if (!a || !b) return;
    await save.mutateAsync({ id: a.id, sortOrder: b.sortOrder }).catch(() => null);
    await save.mutateAsync({ id: b.id, sortOrder: a.sortOrder }).catch(() => null);
  };

  return (
    <Card>
      <CardHeader title="Lead stages" />
      <CardBody className="space-y-3">
        <Table>
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Name</Th>
              <Th>Category</Th>
              <Th>Active</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {list.map((s, i) => (
              <Tr key={s.id}>
                <Td className="whitespace-nowrap">
                  <button className="p-0.5 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${s.name} up`}>
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button className="p-0.5 disabled:opacity-30" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${s.name} down`}>
                    <ArrowDown className="size-3.5" />
                  </button>
                </Td>
                <Td>
                  <InlineName value={s.name} onSave={(n) => save.mutate({ id: s.id, name: n })} />
                </Td>
                <Td>
                  <Badge tone={s.category === 'open' ? 'primary' : s.category === 'won' ? 'success' : 'neutral'}>{s.category}</Badge>
                  {s.isSystem ? <Badge className="ml-1">Built-in</Badge> : null}
                </Td>
                <Td>
                  <input type="checkbox" checked={s.isActive !== false} onChange={(e) => save.mutate({ id: s.id, isActive: e.target.checked })} aria-label={`${s.name} active`} />
                </Td>
                <Td>
                  {!s.isSystem ? (
                    <Button variant="link" size="sm" className="text-danger" onClick={() => remove.mutate(s.id)}>
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
          <Input className="h-8 w-48 text-xs" placeholder="New stage" value={name} onChange={(e) => setName(e.target.value)} />
          <Select className="h-8 w-32 text-xs" value={category} onChange={(e) => setCategory(e.target.value as Stage['category'])} aria-label="Category">
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="invalid">Invalid</option>
          </Select>
          <Button size="sm" type="submit" disabled={!name.trim() || create.isPending}>
            Add stage
          </Button>
        </form>
        {save.error || create.error || remove.error ? <Alert>{errorMessage(save.error ?? create.error ?? remove.error)}</Alert> : null}
      </CardBody>
    </Card>
  );
}

function ReasonsCard() {
  const reasons = useReasons();
  const refresh = useInvalidate('reasons');
  const [name, setName] = useState('');
  const [type, setType] = useState<Reason['type']>('lost');
  const save = useMutation({
    mutationFn: async ({ id, ...body }: Partial<Reason> & { id: string }) => unwrap(await api.PATCH('/reasons/{id}', { params: { path: { id } }, body: body as Reason })),
    onSuccess: refresh,
  });
  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST('/reasons', { body: { name: name.trim(), type } as Reason })),
    onSuccess: () => {
      setName('');
      void refresh();
    },
  });
  const remove = useMutation({ mutationFn: async (id: string) => unwrap(await api.DELETE('/reasons/{id}', { params: { path: { id } } })), onSuccess: refresh });
  const label = { lost: 'Lost', invalid: 'Invalid', reassignment: 'Reassignment' } as const;

  return (
    <Card>
      <CardHeader title="Reasons (lost, invalid, reassignment)" />
      <CardBody className="space-y-3">
        <Table>
          <thead>
            <tr>
              <Th>Reason</Th>
              <Th>For</Th>
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
                <Td>{label[r.type]}</Td>
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
          <Select className="h-8 w-36 text-xs" value={type} onChange={(e) => setType(e.target.value as Reason['type'])} aria-label="Reason type">
            <option value="lost">Lost</option>
            <option value="invalid">Invalid</option>
            <option value="reassignment">Reassignment</option>
          </Select>
          <Button size="sm" type="submit" disabled={!name.trim() || create.isPending}>
            Add reason
          </Button>
        </form>
        {save.error || create.error || remove.error ? <Alert>{errorMessage(save.error ?? create.error ?? remove.error)}</Alert> : null}
      </CardBody>
    </Card>
  );
}

function SourcesCard() {
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
function InlineName({ value, onSave }: { value: string; onSave: (v: string) => void }) {
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
