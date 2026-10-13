'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Field, Input, Select, Table, Td, Th, Tr } from '@crm/ui';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { formatDateTime } from '@/core/format';
import { byId, useTeams, useUsers } from '@/core/lookups';
import { useCan, useMe } from '@/core/session';
import { useRoles, useUserMutations, useWorkload, type User } from './team-api';

/**
 * Manage users (SRS §4.1–4.3): add users, set role and team, turn lead assignment on or off,
 * and deactivate (after reassigning their leads) or reactivate.
 */
export function UsersTab() {
  const can = useCan();
  const me = useMe();
  const users = useUsers();
  const roles = byId(useRoles().data);
  const teams = byId(useTeams().data);
  const { receivesLeads, reactivate } = useUserMutations();
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [deactivating, setDeactivating] = useState<User | null>(null);
  const [q, setQ] = useState('');

  const list = (users.data ?? []).filter((u) => !q || `${u.fullName} ${u.email}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-8 w-64 text-xs" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="ml-auto" />
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus /> Add user
        </Button>
      </div>
      {receivesLeads.error || reactivate.error ? <Alert>{errorMessage(receivesLeads.error ?? reactivate.error)}</Alert> : null}
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Role</Th>
            <Th>Team</Th>
            <Th>Status</Th>
            <Th>Receives leads</Th>
            <Th>Last login</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {list.map((u) => (
            <Tr key={u.id}>
              <Td>
                <p className="font-medium">{u.fullName}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </Td>
              <Td>{roles.get(u.roleId)?.name ?? '—'}</Td>
              <Td>{u.teamId ? (teams.get(u.teamId)?.name ?? '—') : '—'}</Td>
              <Td>
                <Badge tone={u.status === 'active' ? 'success' : u.status === 'invited' ? 'info' : 'neutral'}>{u.status}</Badge>
              </Td>
              <Td>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={u.receivesLeads}
                    disabled={!can('users.lead_assignment') || u.status === 'inactive' || receivesLeads.isPending}
                    onChange={(e) => receivesLeads.mutate({ id: u.id, receivesLeads: e.target.checked })}
                  />
                  {u.receivesLeads ? 'On' : 'Off'}
                </label>
              </Td>
              <Td className="text-xs">{formatDateTime(u.lastLoginAt, me.data?.user.timezone)}</Td>
              <Td className="whitespace-nowrap text-right">
                <Button variant="link" size="sm" onClick={() => setEditing(u)}>
                  Edit
                </Button>
                {u.status === 'inactive' ? (
                  <Button variant="link" size="sm" className="ml-3" onClick={() => reactivate.mutate(u.id)}>
                    Reactivate
                  </Button>
                ) : u.id !== me.data?.user.id ? (
                  <Button variant="link" size="sm" className="ml-3 text-danger" onClick={() => setDeactivating(u)}>
                    Deactivate
                  </Button>
                ) : null}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <UserDialog user={editing} onClose={() => setEditing(null)} />
      <DeactivateDialog user={deactivating} onClose={() => setDeactivating(null)} />
    </div>
  );
}

function UserDialog({ user, onClose }: { user: User | 'new' | null; onClose: () => void }) {
  const roles = useRoles();
  const teams = useTeams();
  const { create, update } = useUserMutations();
  const existing = user && user !== 'new' ? user : null;
  const mutation = existing ? update : create;
  const [form, setForm] = useState<Record<string, string>>({});
  const v = (k: keyof User) => form[k] ?? (existing ? String((existing[k] as string | null) ?? '') : '');
  const set = (k: string, val: string) => setForm((f) => ({ ...f, [k]: val }));
  const err = (f: string) => (mutation.error instanceof ApiError ? mutation.error.fieldError(f) : undefined);

  function close() {
    setForm({});
    create.reset();
    update.reset();
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      fullName: v('fullName'),
      email: v('email'),
      roleId: v('roleId'),
      ...(v('teamId') ? { teamId: v('teamId') } : existing ? { teamId: null } : {}),
      ...(v('phone') ? { phone: v('phone') } : {}),
      ...(v('location') ? { location: v('location') } : {}),
    };
    const ok = existing
      ? await update.mutateAsync({ id: existing.id, ...(body as Partial<User>) }).catch(() => null)
      : await create.mutateAsync(body as Parameters<typeof create.mutateAsync>[0]).catch(() => null);
    if (ok) close();
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && close()}>
      <DialogContent title={existing ? `Edit ${existing.fullName}` : 'Add user'}>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name *" error={err('fullName')}>
            <Input value={v('fullName')} onChange={(e) => set('fullName', e.target.value)} required />
          </Field>
          <Field label="Work email *" error={err('email')}>
            <Input type="email" value={v('email')} onChange={(e) => set('email', e.target.value)} required disabled={!!existing} />
          </Field>
          <Field label="Role *" error={err('roleId')}>
            <Select value={v('roleId')} onChange={(e) => set('roleId', e.target.value)} required>
              <option value="">Choose a role</option>
              {roles.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Team">
            <Select value={v('teamId')} onChange={(e) => set('teamId', e.target.value)}>
              <option value="">No team</option>
              {teams.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mobile">
            <Input value={v('phone')} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Location">
            <Input value={v('location')} onChange={(e) => set('location', e.target.value)} placeholder="Dubai Marina" />
          </Field>
          {!existing ? <p className="text-xs text-muted-foreground sm:col-span-2">The user is invited by email and uses a seat once they accept.</p> : null}
          {mutation.error ? <Alert className="sm:col-span-2">{errorMessage(mutation.error)}</Alert> : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {existing ? 'Save' : 'Invite user'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const users = useUsers();
  const workload = useWorkload(user?.id ?? null);
  const { deactivate } = useUserMutations();
  const [to, setTo] = useState('');
  const openLeads = workload.data?.openLeads ?? 0;

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && (deactivate.reset(), setTo(''), onClose())}>
      <DialogContent title={`Deactivate ${user?.fullName ?? ''}`}>
        <div className="space-y-3 text-sm">
          <p>
            Open leads: <b>{workload.isLoading ? '…' : openLeads}</b> · overdue: {workload.data?.overdue ?? 0}
          </p>
          {openLeads > 0 ? (
            <Field label="Reassign their leads to *">
              <Select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Choose a user</option>
                {users.data
                  ?.filter((u) => u.status === 'active' && u.id !== user?.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : null}
          {deactivate.error ? <Alert>{errorMessage(deactivate.error)}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={(openLeads > 0 && !to) || deactivate.isPending}
              onClick={async () => {
                if (!user) return;
                const ok = await deactivate.mutateAsync({ id: user.id, ...(to ? { reassignToUserId: to } : {}) }).catch(() => null);
                if (ok) {
                  setTo('');
                  onClose();
                }
              }}
            >
              Deactivate
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
