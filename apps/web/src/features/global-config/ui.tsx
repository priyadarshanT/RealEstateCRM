'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Loading, cn } from '@crm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, History } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage, unwrap } from '@/core/api';
import { formatDateTime } from '@/core/format';
import { useCan } from '@/core/session';

// Building blocks of the Global Configuration pages: labelled On/Off switches, the detail page frame
// (Back, Save Changes, Cancel, unsaved-changes warning) and a tenant setting edited as a draft.

/** On/Off switch (role="switch"), keyboard accessible. */
export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-slate-300',
      )}
    >
      <span className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );
}

/** A setting row: title and explanation on the left, switch with its state on the right; dependent fields below when on. */
export function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
  badge,
  note,
  children,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  badge?: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-b border-border py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {title}
            {badge}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          {note ? <p className="mt-1 text-xs text-muted-foreground/80">{note}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn('w-7 text-right text-xs font-medium', checked ? 'text-primary' : 'text-muted-foreground')}>{checked ? 'On' : 'Off'}</span>
          <Switch checked={checked} onChange={onChange} disabled={disabled} label={title} />
        </div>
      </div>
      {checked && children ? <div className="mt-3 rounded-lg bg-muted/40 p-3">{children}</div> : null}
    </div>
  );
}

/** Asks before leaving with unsaved changes (closing the tab, or Back / Cancel in the page). */
function useLeaveWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}

export const LEAVE_MESSAGE = 'You have unsaved changes. Leave without saving?';

/** Only the Admin (settings.manage) changes Global Configuration; everyone else sees it read only. */
export function useCanEditConfig(): boolean {
  return useCan()('settings.manage');
}

/** Shown on Global Configuration for users who may only look (stakeholder decision: Admin-only editing). */
export function ViewOnlyNotice() {
  return <Alert tone="info">View only. Only the Admin can change Global Configuration.</Alert>;
}

/**
 * Wraps controls so they are disabled for users who may only look: inputs, switches and buttons inside a disabled
 * fieldset cannot be used, while links and page navigation still work.
 */
export function EditGate({ children }: { children: ReactNode }) {
  const canEdit = useCanEditConfig();
  return (
    <fieldset disabled={!canEdit} className="contents">
      {children}
    </fieldset>
  );
}

/**
 * Detail page of a Global Configuration module: title, description, Back, and (for forms) Save Changes and Cancel.
 * Unsaved changes are kept until saved or cancelled; leaving asks first. Read only without settings.manage.
 */
export function ConfigShell({
  title,
  description,
  dirty = false,
  saving = false,
  onSave,
  onCancel,
  error,
  saved,
  actions,
  children,
}: {
  title: string;
  description: string;
  dirty?: boolean;
  saving?: boolean;
  onSave?: () => void;
  onCancel?: () => void;
  error?: unknown;
  saved?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const canEdit = useCanEditConfig();
  useLeaveWarning(dirty);
  const back = () => {
    if (!dirty || window.confirm(LEAVE_MESSAGE)) router.push('/configuration');
  };
  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={back} className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary">
            <ArrowLeft className="size-3.5" /> Global Configuration
          </button>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {canEdit ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {canEdit ? null : <ViewOnlyNotice />}
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      {saved && !dirty ? <Alert tone="success">Changes saved.</Alert> : null}
      <EditGate>{children}</EditGate>
      {onSave && canEdit ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:left-60">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <span className={cn('text-sm', dirty ? 'font-medium text-amber-700' : 'text-muted-foreground')}>{dirty ? 'You have unsaved changes' : 'All changes saved'}</span>
            <div className="flex gap-2">
              <Button variant="outline" disabled={!dirty || saving} onClick={onCancel}>
                Cancel
              </Button>
              <Button disabled={!dirty || saving} onClick={onSave}>
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type SettingResult<T> = { value: T; etag: string | null; updatedAt: string | null };

/**
 * A tenant setting edited as a draft: Save sends it with If-Match, so a change saved by someone else in the
 * meantime is reported (409) instead of being overwritten.
 */
export function useSettingDraft<T extends Record<string, unknown>>(key: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['setting', key],
    queryFn: async (): Promise<SettingResult<T>> => {
      const res = await api.GET('/settings/{key}', { params: { path: { key } } });
      const data = unwrap(res);
      return { value: data.value as T, etag: res.response.headers.get('ETag'), updatedAt: (data.updatedAt as string | null | undefined) ?? null };
    },
  });
  const [draft, setDraft] = useState<T | null>(null);
  useEffect(() => {
    if (query.data && draft === null) setDraft(structuredClone(query.data.value));
  }, [query.data, draft]);
  const dirty = useMemo(() => !!query.data && !!draft && JSON.stringify(draft) !== JSON.stringify(query.data.value), [draft, query.data]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.PUT('/settings/{key}', {
        params: { path: { key } },
        body: { value: draft as Record<string, unknown> },
        headers: query.data?.etag ? { 'If-Match': query.data.etag } : {},
      });
      return unwrap(res);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['setting', key] });
      await qc.invalidateQueries({ queryKey: ['setting-history', key] });
      await qc.invalidateQueries({ queryKey: ['settings'] });
      await qc.invalidateQueries({ queryKey: ['client-policy'] });
      setDraft(null);
    },
  });
  const conflict = save.error instanceof ApiError && save.error.status === 409;

  return {
    loading: query.isLoading,
    loadError: query.error,
    value: query.data?.value,
    updatedAt: query.data?.updatedAt ?? null,
    draft,
    set: (patch: Partial<T>) => setDraft((d) => (d ? { ...d, ...patch } : d)),
    dirty,
    save: () => save.mutate(),
    saving: save.isPending,
    saved: save.isSuccess,
    error: conflict ? new Error('Someone else saved these settings first. Reload the page to see their changes, then make yours again.') : save.error,
    fieldError: (field: string) => (save.error instanceof ApiError ? save.error.fieldError(`value.${field}`) : undefined),
    cancel: () => {
      setDraft(query.data ? structuredClone(query.data.value) : null);
      save.reset();
    },
    reload: async () => {
      save.reset();
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['setting', key] });
    },
  };
}

function flatten(v: unknown, prefix = ''): Record<string, string> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return { [prefix || 'value']: Array.isArray(v) ? v.join(', ') || '—' : v === null || v === undefined ? '—' : String(v) };
  return Object.entries(v as Record<string, unknown>).reduce((acc, [k, x]) => ({ ...acc, ...flatten(x, prefix ? `${prefix}.${k}` : k) }), {} as Record<string, string>);
}

const label = (path: string) => path.split('.').map((p) => p.replace(/_/g, ' ')).join(' › ');

/** "Change history" for a setting: who changed it, when, and the values before and after (audit log). */
export function HistoryButton({ settingKey }: { settingKey: string }) {
  const [open, setOpen] = useState(false);
  const history = useQuery({
    queryKey: ['setting-history', settingKey],
    enabled: open,
    queryFn: async () => unwrap(await api.GET('/settings/{key}/history', { params: { path: { key: settingKey } } })).data,
  });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <History className="size-4" /> Change history
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Change history" wide>
          {history.isLoading ? <Loading /> : null}
          {history.error ? <Alert>{errorMessage(history.error)}</Alert> : null}
          {history.data?.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No changes yet. The defaults are in use.</p> : null}
          <ol className="max-h-[60vh] space-y-3 overflow-y-auto">
            {(history.data ?? []).map((h, i) => {
              const before = flatten(h.before);
              const after = flatten(h.after);
              const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
              return (
                <li key={i} className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{h.userName ?? 'System'}</span> · {formatDateTime(h.at)}
                  </p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {changed.map((k) => (
                      <li key={k} className="flex flex-wrap items-center gap-2">
                        <span className="capitalize text-muted-foreground">{label(k)}:</span>
                        <span className="rounded bg-red-50 px-1.5 text-red-700 line-through">{before[k] ?? '—'}</span>
                        <span>→</span>
                        <span className="rounded bg-emerald-50 px-1.5 text-emerald-700">{after[k] ?? '—'}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Small section card used inside the detail pages. */
export function Section({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5', className)}>
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export const SoonBadge = () => <Badge tone="neutral">Not available yet</Badge>;

export function Back() {
  return (
    <Link href="/configuration" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary">
      <ArrowLeft className="size-3.5" /> Global Configuration
    </Link>
  );
}
