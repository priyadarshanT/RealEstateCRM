'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Field, Input, Loading, Select, Table, Td, Th, Tr } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { byId, useCampaigns, useSources, useTeams, useUsers } from '@/core/lookups';

type Rule = Schemas['AssignmentRule'];
type RuleInput = Partial<Omit<Rule, 'id'>>;

/**
 * Assignment rules (SRS §4.8–4.9): round-robin within a team or listed agents, matched by campaign, source,
 * language and location. Rules are tried top to bottom; leads that match none go to Unassigned.
 */
export function AssignmentTab() {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ['assignment-rules'], queryFn: async () => unwrap(await api.GET('/assignment-rules')).data });
  const teams = byId(useTeams().data);
  const sources = byId(useSources().data);
  const campaigns = byId(useCampaigns().data);
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['assignment-rules'] });

  const toggle = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) =>
      unwrap(await api.PATCH('/assignment-rules/{id}', { params: { path: { id } }, body: { isActive } as Rule })),
    onSuccess: refresh,
  });
  const reorder = useMutation({
    mutationFn: async (ruleIds: string[]) => unwrap(await api.PUT('/assignment-rules/order', { body: { ruleIds } })),
    onSuccess: refresh,
  });
  const list = (rules.data ?? []).slice().sort((a, b) => a.priority - b.priority);
  const move = (i: number, dir: -1 | 1) => {
    const ids = list.map((r) => r.id);
    [ids[i], ids[i + dir]] = [ids[i + dir]!, ids[i]!];
    reorder.mutate(ids);
  };
  const describe = (r: Rule) =>
    [
      r.conditions.campaignIds?.length ? `Campaign: ${r.conditions.campaignIds.map((id) => campaigns.get(id)?.name ?? '?').join(', ')}` : null,
      r.conditions.sourceIds?.length ? `Source: ${r.conditions.sourceIds.map((id) => sources.get(id)?.name ?? '?').join(', ')}` : null,
      r.conditions.languages?.length ? `Language: ${r.conditions.languages.join(', ')}` : null,
      r.conditions.locations?.length ? `Location: ${r.conditions.locations.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Every lead';

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus /> New rule
        </Button>
      </div>
      {toggle.error || reorder.error ? <Alert>{errorMessage(toggle.error ?? reorder.error)}</Alert> : null}
      {rules.isLoading ? <Loading /> : null}
      <Table>
        <thead>
          <tr>
            <Th>Order</Th>
            <Th>Rule</Th>
            <Th>When</Th>
            <Th>Goes to</Th>
            <Th>Active</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {list.map((r, i) => (
            <Tr key={r.id}>
              <Td className="whitespace-nowrap">
                <button className="p-0.5 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  <ArrowUp className="size-3.5" />
                </button>
                <button className="p-0.5 disabled:opacity-30" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                  <ArrowDown className="size-3.5" />
                </button>
              </Td>
              <Td className="font-medium">{r.name}</Td>
              <Td className="text-xs">{describe(r)}</Td>
              <Td className="text-xs">
                {r.targetTeamId ? `Team ${teams.get(r.targetTeamId)?.name ?? ''}` : `${r.memberUserIds?.length ?? 0} agents`} · round-robin
                {r.respectAvailability ? <Badge className="ml-1">skips unavailable</Badge> : null}
              </Td>
              <Td>
                <input type="checkbox" checked={r.isActive !== false} onChange={(e) => toggle.mutate({ id: r.id, isActive: e.target.checked })} aria-label={`${r.name} active`} />
              </Td>
              <Td>
                <Button variant="link" size="sm" onClick={() => setEditing(r)}>
                  Edit
                </Button>
              </Td>
            </Tr>
          ))}
          {list.length === 0 && !rules.isLoading ? (
            <tr>
              <Td colSpan={6} className="text-center text-muted-foreground">
                No rules yet: new leads go to Unassigned until a rule matches.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
      <RuleDialog rule={editing} nextPriority={(list.at(-1)?.priority ?? 0) + 1} onClose={() => setEditing(null)} />
    </div>
  );
}

function RuleDialog({ rule, nextPriority, onClose }: { rule: Rule | 'new' | null; nextPriority: number; onClose: () => void }) {
  const qc = useQueryClient();
  const teams = useTeams();
  const users = useUsers();
  const sources = useSources();
  const campaigns = useCampaigns();
  const existing = rule && rule !== 'new' ? rule : null;
  const [form, setForm] = useState<RuleInput | null>(null);
  const value: RuleInput = form ?? (existing ? { ...existing } : { name: '', conditions: {}, memberUserIds: [], respectAvailability: true, isActive: true });
  const set = (patch: RuleInput) => setForm({ ...value, ...patch });
  const setCond = (patch: Partial<Rule['conditions']>) => set({ conditions: { ...value.conditions, ...patch } });
  const list = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  const save = useMutation({
    mutationFn: async () => {
      const { id: _id, ...rest } = value as Partial<Rule>;
      const body = { ...rest, priority: existing?.priority ?? nextPriority } as Rule;
      return existing
        ? unwrap(await api.PATCH('/assignment-rules/{id}', { params: { path: { id: existing.id } }, body }))
        : unwrap(await api.POST('/assignment-rules', { body }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['assignment-rules'] });
      close();
    },
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/assignment-rules/{id}', { params: { path: { id: existing!.id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['assignment-rules'] });
      close();
    },
  });
  function close() {
    setForm(null);
    save.reset();
    remove.reset();
    onClose();
  }
  const multi = (selected: string[] | undefined, e: React.ChangeEvent<HTMLSelectElement>) => [...e.target.selectedOptions].map((o) => o.value);

  return (
    <Dialog open={!!rule} onOpenChange={(o) => !o && close()}>
      <DialogContent title={existing ? `Edit rule ${existing.name}` : 'New assignment rule'} wide>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Rule name *" className="sm:col-span-2">
            <Input value={value.name ?? ''} onChange={(e) => set({ name: e.target.value })} required placeholder="Beachfront Q4 → Team A" />
          </Field>
          <Field label="Campaigns (none = any)">
            <Select multiple className="h-24" value={value.conditions?.campaignIds ?? []} onChange={(e) => setCond({ campaignIds: multi(value.conditions?.campaignIds, e) })}>
              {campaigns.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sources (none = any)">
            <Select multiple className="h-24" value={value.conditions?.sourceIds ?? []} onChange={(e) => setCond({ sourceIds: multi(value.conditions?.sourceIds, e) })}>
              {sources.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Languages (comma separated)">
            <Input defaultValue={(value.conditions?.languages ?? []).join(', ')} onBlur={(e) => setCond({ languages: list(e.target.value) })} placeholder="Arabic, Russian" />
          </Field>
          <Field label="Locations (comma separated)">
            <Input defaultValue={(value.conditions?.locations ?? []).join(', ')} onBlur={(e) => setCond({ locations: list(e.target.value) })} placeholder="UAE, KSA" />
          </Field>
          <Field label="Round-robin within team">
            <Select value={value.targetTeamId ?? ''} onChange={(e) => set({ targetTeamId: e.target.value || null })}>
              <option value="">— use the agents listed instead —</option>
              {teams.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Or these agents">
            <Select multiple className="h-24" disabled={!!value.targetTeamId} value={value.memberUserIds ?? []} onChange={(e) => set({ memberUserIds: multi(value.memberUserIds, e) })}>
              {users.data
                ?.filter((u) => u.status === 'active')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={value.respectAvailability !== false} onChange={(e) => set({ respectAvailability: e.target.checked })} />
            Skip agents on leave, unavailable or with lead assignment turned off
          </label>
          {save.error || remove.error ? <Alert className="sm:col-span-2">{errorMessage(save.error ?? remove.error)}</Alert> : null}
          <div className="flex justify-between gap-2 sm:col-span-2">
            {existing ? (
              <Button type="button" variant="outline" className="text-danger" onClick={() => remove.mutate()}>
                Delete rule
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending || !value.name}>
                Save rule
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
