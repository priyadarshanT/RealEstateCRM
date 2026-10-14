'use client';

import { Button, Input, Select } from '@crm/ui';
import { X } from 'lucide-react';
import { DATE_PRESETS, type DatePreset } from '@/core/date-range';
import { useCampaigns, useProjectList, useSources, useStages, useTeams, useUsers } from '@/core/lookups';
import { useCan } from '@/core/session';

/** Filter values held by the lead list. Turned into GET /leads query parameters by the screen. */
export interface LeadFilterState {
  datePreset: DatePreset;
  sourceId?: string;
  projectId?: string;
  campaignId?: string;
  ownerUserId?: string;
  teamId?: string;
  stageId?: string;
  budgetMin?: string;
  budgetMax?: string;
}

export const EMPTY_FILTERS: LeadFilterState = { datePreset: 'any' };

export function LeadFilters({ value, onChange }: { value: LeadFilterState; onChange: (v: LeadFilterState) => void }) {
  const can = useCan();
  const stages = useStages();
  const sources = useSources();
  const campaigns = useCampaigns();
  const projects = useProjectList();
  const users = useUsers();
  const teams = useTeams();
  const set = (patch: Partial<LeadFilterState>) => onChange({ ...value, ...patch });
  const opt = (v: string) => v || undefined;
  const active = Object.entries(value).some(([k, v]) => (k === 'datePreset' ? v !== 'any' : !!v));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select className="h-8 w-auto text-xs" value={value.datePreset} onChange={(e) => set({ datePreset: e.target.value as DatePreset })} aria-label="Created">
        {DATE_PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.key === 'any' ? 'Created: any time' : p.label}
          </option>
        ))}
      </Select>
      <Select className="h-8 w-auto text-xs" value={value.sourceId ?? ''} onChange={(e) => set({ sourceId: opt(e.target.value) })} aria-label="Source">
        <option value="">Source</option>
        {sources.data?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
      <Select className="h-8 w-auto text-xs" value={value.projectId ?? ''} onChange={(e) => set({ projectId: opt(e.target.value) })} aria-label="Project">
        <option value="">Project</option>
        {projects.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Select className="h-8 w-auto text-xs" value={value.campaignId ?? ''} onChange={(e) => set({ campaignId: opt(e.target.value) })} aria-label="Campaign">
        <option value="">Campaign</option>
        {campaigns.data?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      {can('users.manage') ? (
        <>
          <Select className="h-8 w-auto text-xs" value={value.ownerUserId ?? ''} onChange={(e) => set({ ownerUserId: opt(e.target.value) })} aria-label="Agent">
            <option value="">Agent</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </Select>
          <Select className="h-8 w-auto text-xs" value={value.teamId ?? ''} onChange={(e) => set({ teamId: opt(e.target.value) })} aria-label="Team">
            <option value="">Team</option>
            {teams.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </>
      ) : null}
      <Select className="h-8 w-auto text-xs" value={value.stageId ?? ''} onChange={(e) => set({ stageId: opt(e.target.value) })} aria-label="Stage">
        <option value="">Stage</option>
        {stages.data?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
      <Input
        className="h-8 w-28 text-xs"
        inputMode="decimal"
        placeholder="Budget min"
        value={value.budgetMin ?? ''}
        onChange={(e) => set({ budgetMin: opt(e.target.value.replace(/[^\d.]/g, '')) })}
      />
      <Input
        className="h-8 w-28 text-xs"
        inputMode="decimal"
        placeholder="Budget max"
        value={value.budgetMax ?? ''}
        onChange={(e) => set({ budgetMax: opt(e.target.value.replace(/[^\d.]/g, '')) })}
      />
      {active ? (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
          <X /> Clear
        </Button>
      ) : null}
    </div>
  );
}
