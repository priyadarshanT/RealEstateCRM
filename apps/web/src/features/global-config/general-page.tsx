'use client';

import { Field, Input, Loading, Select, cn } from '@crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, unwrap } from '@/core/api';
import { countries } from './countries';
import { CurrenciesCard } from './currencies-card';
import { NumberingCard } from './numbering-card';
import { ConfigShell, HistoryButton, Section, SwitchRow, useSettingDraft } from './ui';

type Watermark = {
  enabled: boolean;
  kind: 'text' | 'logo';
  text: string;
  opacity: number;
  position: 'center' | 'tiled' | 'bottom_right' | 'top_left';
  apply_to: ('brochures' | 'floor_plans' | 'images' | 'documents')[];
};
type General = {
  call_notifications: boolean;
  call_detection: boolean;
  default_country: string;
  default_currency: string;
  watermark: Watermark;
};

const POSITIONS: { key: Watermark['position']; label: string }[] = [
  { key: 'bottom_right', label: 'Bottom right' },
  { key: 'center', label: 'Center' },
  { key: 'top_left', label: 'Top left' },
  { key: 'tiled', label: 'Tiled (repeated)' },
];
const OUTPUTS: { key: Watermark['apply_to'][number]; label: string }[] = [
  { key: 'brochures', label: 'Brochures' },
  { key: 'floor_plans', label: 'Floor plans' },
  { key: 'images', label: 'Project images' },
  { key: 'documents', label: 'Documents' },
];

/** Global Configuration › General (§2): call alerts, default country and currency, watermark; currencies and invoice numbering. */
export function GeneralPage() {
  const s = useSettingDraft<General>('general.preferences');
  const currencies = useQuery({ queryKey: ['currencies'], queryFn: async () => unwrap(await api.GET('/currencies')).data });
  const d = s.draft;
  const setW = (patch: Partial<Watermark>) => d && s.set({ watermark: { ...d.watermark, ...patch } });

  return (
    <ConfigShell
      title="General"
      description="Common platform configuration"
      dirty={s.dirty}
      saving={s.saving}
      saved={s.saved}
      error={s.error ?? s.loadError}
      onSave={s.save}
      onCancel={s.cancel}
      actions={<HistoryButton settingKey="general.preferences" />}
    >
      {!d ? (
        <Loading />
      ) : (
        <>
          <Section title="Calls">
            <SwitchRow
              title="Call Notifications"
              description="Show an alert to the agent when a lead calls."
              checked={d.call_notifications}
              onChange={(v) => s.set({ call_notifications: v })}
              note="Needs a calling integration (IVR or phone app); without one there are no calls to announce."
            />
            <SwitchRow
              title="Call Detection"
              description="Match incoming and outgoing calls to leads and log them on the timeline automatically."
              checked={d.call_detection}
              onChange={(v) => s.set({ call_detection: v })}
              note="Needs a calling integration (IVR or phone app)."
            />
          </Section>

          <Section title="Defaults" description="Used when a new lead, project or price has no country or currency of its own. Amounts are never converted silently.">
            <div className="grid gap-4 sm:grid-cols-2">
              <CountryPicker value={d.default_country} onChange={(code) => s.set({ default_country: code })} error={s.fieldError('default_country')} />
              <Field label="Default currency" error={s.fieldError('default_currency')}>
                <Select value={d.default_currency} onChange={(e) => s.set({ default_currency: e.target.value })}>
                  {(currencies.data ?? [{ code: d.default_currency, name: d.default_currency }]).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name} ({symbolOf(c.code ?? '')})
                    </option>
                  ))}
                </Select>
                <span className="text-xs text-muted-foreground">Choose from the enabled currencies below.</span>
              </Field>
            </div>
          </Section>

          <Section title="Watermark" description="Mark files shared with leads with your logo or name.">
            <SwitchRow
              title="Watermark"
              description="Add a watermark to the selected file types."
              checked={d.watermark.enabled}
              onChange={(v) => setW({ enabled: v })}
              note="Saved here and shown in the preview; stamping it onto files arrives with the file sharing update."
            >
              <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Watermark type">
                    <Select value={d.watermark.kind} onChange={(e) => setW({ kind: e.target.value as Watermark['kind'] })}>
                      <option value="text">Text</option>
                      <option value="logo">Company logo</option>
                    </Select>
                  </Field>
                  {d.watermark.kind === 'text' ? (
                    <Field label="Text *" error={s.fieldError('watermark.text')}>
                      <Input maxLength={60} value={d.watermark.text} onChange={(e) => setW({ text: e.target.value })} placeholder="Your company name" />
                    </Field>
                  ) : null}
                  <Field label={`Opacity: ${d.watermark.opacity}%`}>
                    <input type="range" min={5} max={80} value={d.watermark.opacity} onChange={(e) => setW({ opacity: Number(e.target.value) })} className="accent-primary" />
                  </Field>
                  <Field label="Placement">
                    <Select value={d.watermark.position} onChange={(e) => setW({ position: e.target.value as Watermark['position'] })}>
                      {POSITIONS.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <fieldset className="sm:col-span-2">
                    <legend className="mb-1 text-xs font-medium text-muted-foreground">Apply to</legend>
                    <div className="flex flex-wrap gap-3">
                      {OUTPUTS.map((o) => (
                        <label key={o.key} className="inline-flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={d.watermark.apply_to.includes(o.key)}
                            onChange={(e) => setW({ apply_to: e.target.checked ? [...d.watermark.apply_to, o.key] : d.watermark.apply_to.filter((k) => k !== o.key) })}
                          />
                          {o.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
                <WatermarkPreview w={d.watermark} />
              </div>
            </SwitchRow>
          </Section>
        </>
      )}

      <CurrenciesCard />
      <NumberingCard />
    </ConfigShell>
  );
}

function symbolOf(code: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

/** Searchable country list with ISO code and dial code. */
function CountryPicker({ value, onChange, error }: { value: string; onChange: (code: string) => void; error?: string }) {
  const [q, setQ] = useState('');
  const all = countries();
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? all.filter((c) => c.name.toLowerCase().includes(t) || c.code.toLowerCase() === t || c.dial.includes(t.replace(/^\+?/, '+'))) : all;
    return list.some((c) => c.code === value) ? list : [...all.filter((c) => c.code === value), ...list];
  }, [q, all, value]);
  return (
    <Field label="Default country" error={error}>
      <Input placeholder="Search name, code or +dial code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search countries" />
      <Select size={5} value={value} onChange={(e) => onChange(e.target.value)} className="h-auto py-1">
        {shown.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name} · {c.code} · {c.dial}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const PLACE: Record<Watermark['position'], string> = {
  bottom_right: 'items-end justify-end',
  center: 'items-center justify-center',
  top_left: 'items-start justify-start',
  tiled: '',
};

function WatermarkPreview({ w }: { w: Watermark }) {
  const mark = w.kind === 'logo' ? 'LOGO' : w.text.trim() || 'Your text';
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">Preview</p>
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-gradient-to-br from-sky-200 via-sky-100 to-amber-100">
        {w.position === 'tiled' ? (
          <div className="absolute inset-0 grid grid-cols-3 place-items-center gap-2 p-2" style={{ opacity: w.opacity / 100 }}>
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className="-rotate-12 text-xs font-bold text-slate-900">
                {mark}
              </span>
            ))}
          </div>
        ) : (
          <div className={cn('absolute inset-0 flex p-3', PLACE[w.position])}>
            <span className={cn('font-bold text-slate-900', w.kind === 'logo' ? 'rounded border-2 border-slate-900 px-2 py-1 text-sm' : 'text-base')} style={{ opacity: w.opacity / 100 }}>
              {mark}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
