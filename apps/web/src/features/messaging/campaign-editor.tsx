'use client';

import { Alert, Button, Dialog, DialogContent, Field, Input, Select } from '@crm/ui';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { isoToLocalInput, localInputToIso } from '@/core/format';
import { useCampaigns, useSources, useStages } from '@/core/lookups';
import { CAMPAIGN_FIELDS, useCampaignActions, type Campaign } from './campaigns-api';
import { placeholders, useTemplates, type Channel } from './messaging-api';

const TABS = [
  { key: '', label: 'All leads I can see' },
  { key: 'new', label: 'New' },
  { key: 'pending', label: 'Pending' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'cold', label: 'Cold (No Response)' },
];

/** Create or change a bulk campaign: name, channel, approved template, audience (lead filters) and schedule. */
export function CampaignEditor({ campaign, onClose }: { campaign: Campaign | 'new' | null; onClose: () => void }) {
  const existing = campaign && campaign !== 'new' ? campaign : null;
  const { create, update } = useCampaignActions();
  const sources = useSources();
  const stages = useStages();
  const adCampaigns = useCampaigns();
  const [name, setName] = useState(existing?.name ?? '');
  const [channel, setChannel] = useState<Channel>(existing?.channel ?? 'whatsapp');
  const [templateId, setTemplateId] = useState(existing?.templateId ?? '');
  const [filter, setFilter] = useState<Record<string, string>>((existing?.audienceFilter as Record<string, string>) ?? {});
  const [scheduledAt, setScheduledAt] = useState(existing?.scheduledAt ? isoToLocalInput(existing.scheduledAt) : '');
  const templates = useTemplates({ channel, status: 'approved' });
  // Campaign templates may only use lead fields ({{first_name}}, {{full_name}}).
  const usable = (templates.data ?? []).filter((t) => [...placeholders(t.subject), ...placeholders(t.body)].every((n) => CAMPAIGN_FIELDS.includes(n)));
  const m = existing ? update : create;
  const setF = (k: string, v: string) => setFilter((f) => Object.fromEntries(Object.entries({ ...f, [k]: v }).filter(([, x]) => x)));

  function close() {
    create.reset();
    update.reset();
    onClose();
  }

  async function save() {
    const body = { name: name.trim(), channel, templateId, audienceFilter: filter, scheduledAt: scheduledAt ? localInputToIso(scheduledAt) : null };
    const ok = existing ? await update.mutateAsync({ id: existing.id, ...body }).catch(() => null) : await create.mutateAsync(body).catch(() => null);
    if (ok) close();
  }

  const fieldErr = (f: string) => (m.error instanceof ApiError ? m.error.fieldError(f) : undefined);

  return (
    <Dialog open={!!campaign} onOpenChange={(o) => !o && close()}>
      <DialogContent title={existing ? `Edit ${existing.name}` : 'New bulk campaign'} wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Campaign name *" error={fieldErr('name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Beachfront launch" />
          </Field>
          <Field label="Channel">
            <Select value={channel} onChange={(e) => (setChannel(e.target.value as Channel), setTemplateId(''))}>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
            </Select>
          </Field>
          <Field label="Approved template *" error={fieldErr('templateId')} className="sm:col-span-2">
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">{usable.length ? 'Choose a template' : 'No approved template with only {{first_name}} / {{full_name}}'}</option>
              {usable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.language}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-xs font-semibold uppercase text-muted-foreground sm:col-span-2">Audience (leads you can see)</p>
          <Field label="Leads">
            <Select value={filter.tab ?? ''} onChange={(e) => setF('tab', e.target.value)}>
              {TABS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Stage">
            <Select value={filter.stageId ?? ''} onChange={(e) => setF('stageId', e.target.value)}>
              <option value="">Any stage</option>
              {stages.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Source">
            <Select value={filter.sourceId ?? ''} onChange={(e) => setF('sourceId', e.target.value)}>
              <option value="">Any source</option>
              {sources.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ad campaign">
            <Select value={filter.campaignId ?? ''} onChange={(e) => setF('campaignId', e.target.value)}>
              <option value="">Any</option>
              {adCampaigns.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Created from">
            <Input type="date" value={filter.createdFrom ?? ''} onChange={(e) => setF('createdFrom', e.target.value)} />
          </Field>
          <Field label="Created to">
            <Input type="date" value={filter.createdTo ?? ''} onChange={(e) => setF('createdTo', e.target.value)} />
          </Field>
          <Field label="Send at (empty = as soon as approved)" className="sm:col-span-2">
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </Field>
          {m.error ? <Alert className="sm:col-span-2">{errorMessage(m.error)}</Alert> : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button disabled={!name.trim() || !templateId || m.isPending} onClick={save}>
              Save as draft
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
