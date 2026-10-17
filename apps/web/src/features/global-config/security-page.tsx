'use client';

import { Badge, Loading } from '@crm/ui';
import { useEffect } from 'react';
import { useCan } from '@/core/session';
import { useClientPolicy } from './policy';
import { ConfigShell, HistoryButton, Section, SwitchRow, useSettingDraft } from './ui';

type Security = { require_2fa: boolean; allow_copy_paste: boolean; disable_screenshots: boolean };

/** Global Configuration › Security (§3). Admin only; every change is kept in the change history (no secrets). */
export function SecurityPage() {
  const s = useSettingDraft<Security>('security.policy');
  const d = s.draft;
  return (
    <ConfigShell
      title="Security"
      description="Authentication and data protection"
      dirty={s.dirty}
      saving={s.saving}
      saved={s.saved}
      error={s.error ?? s.loadError}
      onSave={s.save}
      onCancel={s.cancel}
      actions={<HistoryButton settingKey="security.policy" />}
    >
      {!d ? (
        <Loading />
      ) : (
        <Section title="Protection">
          <SwitchRow
            title="Require Two-Factor Authentication"
            description="Every user confirms sign-in with a second step (authenticator app or code)."
            checked={d.require_2fa}
            onChange={(v) => s.set({ require_2fa: v })}
            note="Takes effect with the production sign-in (AWS Cognito). The local development sign-in has no second step."
          />
          <SwitchRow
            title="Allow Copy and Paste"
            description="When off, users cannot copy, cut or paste in the CRM. Admins keep copy and paste to configure the system."
            checked={d.allow_copy_paste}
            onChange={(v) => s.set({ allow_copy_paste: v })}
          />
          <SwitchRow
            title="Disable Screenshots"
            description="Prevent screenshots of CRM screens."
            badge={<Badge tone="warning">Not supported in web browsers</Badge>}
            checked={d.disable_screenshots}
            onChange={(v) => s.set({ disable_screenshots: v })}
            note="Browsers do not let a website block screenshots. The choice is saved for a future mobile app."
          />
        </Section>
      )}
    </ConfigShell>
  );
}

/** Applies Allow Copy and Paste in the browser for everyone except Admins (settings.manage). Mounted once in the app shell. */
export function SecurityGuard() {
  const can = useCan();
  const policy = useClientPolicy();
  const blocked = policy.data?.allowCopyPaste === false && !can('settings.manage');
  useEffect(() => {
    if (!blocked) return;
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('copy', stop);
    document.addEventListener('cut', stop);
    document.addEventListener('paste', stop);
    return () => {
      document.removeEventListener('copy', stop);
      document.removeEventListener('cut', stop);
      document.removeEventListener('paste', stop);
    };
  }, [blocked]);
  return null;
}
