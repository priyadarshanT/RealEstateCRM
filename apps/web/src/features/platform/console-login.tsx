'use client';

import { Alert, Button, Field, Input } from '@crm/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/** Owner console login (local development). In AWS: its own Cognito pool with a two-factor code (SRS §12 Owner console 1). */
export function ConsoleLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/auth/platform-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    const me = res.ok ? await fetch('/api/v1/platform/me') : res;
    if (!me.ok) {
      const p = (await me.json().catch(() => ({}))) as { detail?: string; title?: string };
      await fetch('/auth/platform-login', { method: 'DELETE' });
      setError(p.detail ?? p.title ?? 'Login failed.');
      setBusy(false);
      return;
    }
    router.replace('/console');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg bg-surface p-6 shadow-xl">
        <div>
          <p className="text-lg font-semibold">EstateCRM · Owner console</p>
          <p className="text-sm text-muted-foreground">Our team only (local development login)</p>
        </div>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@crm.ae" required />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
