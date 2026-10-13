'use client';

import { Alert, Button, Card, CardBody, CardHeader, Dialog, DialogContent, Field, Input, Select, cn } from '@crm/ui';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { byId, useTeams, useUsers } from '@/core/lookups';
import { useDivisions, useRoles, useTeamMutations, type Division, type Team, type User } from './team-api';

/**
 * Manage team (SRS §4.4–4.5, wireframe "Manage team and the 10-minute rule"):
 * Director → General Manager (division) → Sales Manager → Team Leader (team) → Sales Agents.
 */
export function HierarchyTab() {
  const users = useUsers();
  const teams = useTeams();
  const divisions = useDivisions();
  const roles = byId(useRoles().data);
  const userById = byId(users.data);
  const [editTeam, setEditTeam] = useState<Team | 'new' | null>(null);
  const [editDivision, setEditDivision] = useState<Division | 'new' | null>(null);

  const active = (users.data ?? []).filter((u) => u.status !== 'inactive');
  const directors = active.filter((u) => roles.get(u.roleId)?.key === 'director');
  const name = (id: string | null | undefined) => (id ? (userById.get(id)?.fullName ?? '—') : '—');
  const teamsOf = (divisionId: string | null) => (teams.data ?? []).filter((t) => (t.divisionId ?? null) === divisionId);
  const members = (teamId: string) => active.filter((u) => u.teamId === teamId && roles.get(u.roleId)?.key === 'sales_agent');

  const TeamNode = ({ t }: { t: Team }) => (
    <div className="ml-4 border-l-2 border-border pl-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Node tone="mid">Sales Manager · {name(t.salesManagerUserId)}</Node>
        <Node tone="light">
          {t.name} · TL {name(t.teamLeaderUserId)}
        </Node>
        <button className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label={`Edit ${t.name}`} onClick={() => setEditTeam(t)}>
          <Pencil className="size-3.5" />
        </button>
      </div>
      <div className="ml-4 mt-1.5 flex flex-wrap gap-1.5 border-l-2 border-border pl-3">
        {members(t.id).length === 0 ? <span className="text-xs text-muted-foreground">No agents yet</span> : null}
        {members(t.id).map((u) => (
          <AgentChip key={u.id} user={u} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader
          title="Hierarchy"
          actions={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditDivision('new')}>
                <Plus /> Division
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditTeam('new')}>
                <Plus /> Team
              </Button>
            </div>
          }
        />
        <CardBody className="space-y-2">
          <Node tone="dark">Director · {directors.map((d) => d.fullName).join(', ') || '—'}</Node>
          {(divisions.data ?? []).map((d) => (
            <div key={d.id} className="ml-4 space-y-1.5 border-l-2 border-border pl-3">
              <div className="flex items-center gap-1.5">
                <Node tone="dark2">
                  GM · {name(d.gmUserId)} · {d.name}
                </Node>
                <button className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label={`Edit ${d.name}`} onClick={() => setEditDivision(d)}>
                  <Pencil className="size-3.5" />
                </button>
              </div>
              {teamsOf(d.id).map((t) => (
                <TeamNode key={t.id} t={t} />
              ))}
            </div>
          ))}
          {teamsOf(null).length ? <p className="pt-2 text-xs font-semibold uppercase text-muted-foreground">Teams without a division</p> : null}
          {teamsOf(null).map((t) => (
            <TeamNode key={t.id} t={t} />
          ))}
          {active.filter((u) => !u.teamId && roles.get(u.roleId)?.key === 'sales_agent').length ? (
            <div className="pt-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Agents without a team</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {active
                  .filter((u) => !u.teamId && roles.get(u.roleId)?.key === 'sales_agent')
                  .map((u) => (
                    <AgentChip key={u.id} user={u} />
                  ))}
              </div>
            </div>
          ) : null}
          <p className="pt-2 text-xs text-muted-foreground">Move people between teams from Manage users → Edit. A dot means the agent receives new leads.</p>
        </CardBody>
      </Card>
      <ResponseRuleCard />
      <TeamDialog team={editTeam} users={active} divisions={divisions.data ?? []} onClose={() => setEditTeam(null)} />
      <DivisionDialog division={editDivision} users={active} onClose={() => setEditDivision(null)} />
    </div>
  );
}

function Node({ tone, children }: { tone: 'dark' | 'dark2' | 'mid' | 'light'; children: React.ReactNode }) {
  const tones = { dark: 'bg-sidebar text-white', dark2: 'bg-sidebar-active text-white', mid: 'bg-primary text-white', light: 'bg-teal-200 text-teal-950' };
  return <span className={cn('inline-block rounded-md px-2.5 py-1 text-xs font-semibold', tones[tone])}>{children}</span>;
}

function AgentChip({ user }: { user: User }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md bg-teal-50 px-2 py-1 text-xs font-medium text-teal-900', !user.receivesLeads && 'text-muted-foreground line-through')}>
      Agent · {user.fullName}
      {user.receivesLeads ? <span className="size-2 rounded-full bg-primary" /> : <span className="no-underline">(no new leads)</span>}
    </span>
  );
}

/** The 10-minute rule as configured in Settings → Response time (SRS §3.4–3.7). */
function ResponseRuleCard() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: async () => unwrap(await api.GET('/settings')).data });
  const rule = settings.data?.find((s) => s.key === 'leads.response_time')?.value as { minutes?: number } | undefined;
  const minutes = rule?.minutes ?? 10;
  const steps = [
    `Assigned to an agent · ${minutes} min to act`,
    `No action → moves to the next agent in the team · ${minutes} min`,
    'No action → next available agent, until the whole team is tried',
    'Nobody acted → Admin is notified and decides',
  ];
  return (
    <Card className="h-fit">
      <CardHeader title={`If a new lead is not answered in ${minutes} minutes`} />
      <CardBody className="space-y-2">
        {steps.map((s, i) => (
          <div key={s} className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-sm">
            <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white', i === 3 ? 'bg-slate-400' : 'bg-primary')}>{i + 1}</span>
            {s}
          </div>
        ))}
        <p className="rounded-md bg-primary/5 px-2.5 py-2 text-xs">Every move is logged: &quot;No response from agent&quot;. Change the time in Settings → Response time.</p>
      </CardBody>
    </Card>
  );
}

function TeamDialog({ team, users, divisions, onClose }: { team: Team | 'new' | null; users: User[]; divisions: Division[]; onClose: () => void }) {
  const { createTeam, updateTeam, deleteTeam } = useTeamMutations();
  const existing = team && team !== 'new' ? team : null;
  const [form, setForm] = useState<Partial<Team>>({});
  const v = <K extends keyof Team>(k: K) => (k in form ? form[k] : existing?.[k]) ?? '';
  const m = existing ? updateTeam : createTeam;
  const close = () => {
    setForm({});
    createTeam.reset();
    updateTeam.reset();
    deleteTeam.reset();
    onClose();
  };
  const people = (opt: string) => (
    <>
      <option value="">{opt}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.fullName}
        </option>
      ))}
    </>
  );
  return (
    <Dialog open={!!team} onOpenChange={(o) => !o && close()}>
      <DialogContent title={existing ? `Edit team ${existing.name}` : 'New team'}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = { ...form, ...(existing ? {} : { name: String(v('name')) }) };
            const ok = existing ? await updateTeam.mutateAsync({ id: existing.id, ...body }).catch(() => null) : await createTeam.mutateAsync(body).catch(() => null);
            if (ok) close();
          }}
        >
          <Field label="Team name *">
            <Input value={String(v('name'))} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </Field>
          <Field label="Division">
            <Select value={String(v('divisionId'))} onChange={(e) => setForm((f) => ({ ...f, divisionId: e.target.value || null }))}>
              <option value="">No division</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sales manager">
            <Select value={String(v('salesManagerUserId'))} onChange={(e) => setForm((f) => ({ ...f, salesManagerUserId: e.target.value || null }))}>
              {people('—')}
            </Select>
          </Field>
          <Field label="Team leader">
            <Select value={String(v('teamLeaderUserId'))} onChange={(e) => setForm((f) => ({ ...f, teamLeaderUserId: e.target.value || null }))}>
              {people('—')}
            </Select>
          </Field>
          {m.error || deleteTeam.error ? <Alert>{errorMessage(m.error ?? deleteTeam.error)}</Alert> : null}
          <div className="flex justify-between gap-2">
            {existing ? (
              <Button type="button" variant="outline" className="text-danger" onClick={async () => (await deleteTeam.mutateAsync(existing.id).catch(() => null)) !== null && close()}>
                Delete team
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={m.isPending}>
                Save
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DivisionDialog({ division, users, onClose }: { division: Division | 'new' | null; users: User[]; onClose: () => void }) {
  const { createDivision, updateDivision, deleteDivision } = useTeamMutations();
  const existing = division && division !== 'new' ? division : null;
  const [form, setForm] = useState<Partial<Division>>({});
  const v = <K extends keyof Division>(k: K) => (k in form ? form[k] : existing?.[k]) ?? '';
  const m = existing ? updateDivision : createDivision;
  const close = () => {
    setForm({});
    createDivision.reset();
    updateDivision.reset();
    deleteDivision.reset();
    onClose();
  };
  return (
    <Dialog open={!!division} onOpenChange={(o) => !o && close()}>
      <DialogContent title={existing ? `Edit division ${existing.name}` : 'New division'}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = { ...form, ...(existing ? {} : { name: String(v('name')) }) };
            const ok = existing ? await updateDivision.mutateAsync({ id: existing.id, ...body }).catch(() => null) : await createDivision.mutateAsync(body).catch(() => null);
            if (ok) close();
          }}
        >
          <Field label="Division name *">
            <Input value={String(v('name'))} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="Residential" />
          </Field>
          <Field label="General Manager">
            <Select value={String(v('gmUserId'))} onChange={(e) => setForm((f) => ({ ...f, gmUserId: e.target.value || null }))}>
              <option value="">—</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
          </Field>
          {m.error || deleteDivision.error ? <Alert>{errorMessage(m.error ?? deleteDivision.error)}</Alert> : null}
          <div className="flex justify-between gap-2">
            {existing ? (
              <Button type="button" variant="outline" className="text-danger" onClick={async () => (await deleteDivision.mutateAsync(existing.id).catch(() => null)) !== null && close()}>
                Delete division
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={m.isPending}>
                Save
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
