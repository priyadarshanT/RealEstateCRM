'use client';

import { Alert, Badge, Button, Card, CardBody, Field, Input, Loading, Select, cn } from '@crm/ui';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/core/api';
import { usePermissions, useRoleMutations, useRoles, type Role } from './team-api';

const SCOPES: { key: Role['dataScope']; label: string }[] = [
  { key: 'own', label: 'Own records' },
  { key: 'team', label: 'Team' },
  { key: 'division', label: 'Division' },
  { key: 'company', label: 'Whole company' },
];

/** Roles and permissions (SRS §4.6–4.7): built-in roles plus custom roles with ticked actions and a data scope. */
export function RolesTab() {
  const roles = useRoles();
  const permissions = usePermissions();
  const { create, update, remove } = useRoleMutations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; dataScope: Role['dataScope']; permissions: Set<string> } | null>(null);
  const [newName, setNewName] = useState('');

  const role = roles.data?.find((r) => r.id === selectedId) ?? roles.data?.[0];
  useEffect(() => {
    if (role) setDraft({ name: role.name, dataScope: role.dataScope, permissions: new Set(role.permissions) });
  }, [role?.id, role?.permissions.join(',')]); // reset when another role is chosen or after saving

  const byModule = useMemo(() => {
    const m = new Map<string, NonNullable<typeof permissions.data>>();
    for (const p of permissions.data ?? []) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    return [...m.entries()];
  }, [permissions.data]);

  if (roles.isLoading || permissions.isLoading) return <Loading />;
  if (roles.error || permissions.error) return <Alert>{errorMessage(roles.error ?? permissions.error)}</Alert>;

  const dirty =
    role &&
    draft &&
    (draft.name !== role.name || draft.dataScope !== role.dataScope || draft.permissions.size !== role.permissions.length || role.permissions.some((p) => !draft.permissions.has(p)));
  const error = create.error ?? update.error ?? remove.error;

  return (
    <div className="grid gap-3 lg:grid-cols-[16rem_1fr]">
      <div className="space-y-2">
        <div className="rounded-lg border border-border bg-surface p-2">
          {roles.data?.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className={cn('flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm', r.id === role?.id ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-muted')}
            >
              {r.name}
              {r.isSystem ? <Badge>Built-in</Badge> : null}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await create.mutateAsync({ name: newName.trim(), dataScope: 'own', permissions: [] }).catch(() => null);
            if (r) {
              setNewName('');
              setSelectedId(r.id);
            }
          }}
        >
          <Input className="h-8 text-xs" placeholder="New role, e.g. HR" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button size="sm" type="submit" disabled={!newName.trim() || create.isPending}>
            <Plus /> Add
          </Button>
        </form>
      </div>

      {role && draft ? (
        <Card>
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Role name">
                <Input value={draft.name} disabled={role.isSystem} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label="Records this role can see">
                <Select value={draft.dataScope} onChange={(e) => setDraft({ ...draft, dataScope: e.target.value as Role['dataScope'] })}>
                  {SCOPES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {byModule.map(([module, perms]) => (
                <fieldset key={module} className="rounded-md border border-border p-3">
                  <legend className="px-1 text-xs font-semibold uppercase text-muted-foreground">{module}</legend>
                  {perms.map((p) => (
                    <label key={p.key} className="flex items-start gap-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={draft.permissions.has(p.key)}
                        onChange={(e) => {
                          const next = new Set(draft.permissions);
                          if (e.target.checked) next.add(p.key);
                          else next.delete(p.key);
                          setDraft({ ...draft, permissions: next });
                        }}
                      />
                      <span>
                        {p.description}
                        <span className="block text-xs text-muted-foreground">{p.key}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            {error ? <Alert>{errorMessage(error)}</Alert> : null}
            <div className="flex justify-between">
              {!role.isSystem ? (
                <Button
                  variant="outline"
                  className="text-danger"
                  onClick={async () => {
                    if (window.confirm(`Delete the role ${role.name}?`) && (await remove.mutateAsync(role.id).catch(() => null)) !== null) setSelectedId(null);
                  }}
                >
                  Delete role
                </Button>
              ) : (
                <span />
              )}
              <Button
                disabled={!dirty || update.isPending}
                onClick={() =>
                  update.mutate({
                    id: role.id,
                    ...(role.isSystem ? {} : { name: draft.name }),
                    dataScope: draft.dataScope,
                    permissions: [...draft.permissions],
                  })
                }
              >
                Save changes
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
