'use client';

import { Alert, Button, Field, Input } from '@crm/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/**
 * Local development login (AUTH_MODE=dev): company ID and email of an existing user.
 * In AWS this screen is replaced by the Cognito hosted login (OIDC + PKCE, two-factor).
 */
export function LoginScreen() {
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/dashboard';
  const [tenantId, setTenantId] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/auth/dev-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId, email }),
    });
    if (!res.ok) {
      const p = (await res.json().catch(() => ({}))) as { title?: string };
      setError(p.title ?? 'Login failed.');
      setBusy(false);
      return;
    }
    // Confirm the API accepts the token and knows this user before entering the app.
    const me = await fetch('/api/v1/me');
    if (!me.ok) {
      const p = (await me.json().catch(() => ({}))) as { detail?: string; title?: string };
      await fetch('/auth/logout', { method: 'POST' });
      setError(p.detail ?? p.title ?? 'This user was not found in that company.');
      setBusy(false);
      return;
    }
    router.replace(next.startsWith('/') ? next : '/dashboard');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg bg-surface p-6 shadow-xl">
        <div>
          <p className="text-lg font-semibold">
            ● Estate<span className="text-primary">CRM</span>
          </p>
          <p className="text-sm text-muted-foreground">Sign in (local development)</p>
        </div>
        <Field label="Company ID">
          <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="aaaaaaaa-0000-0000-0000-000000000001" required />
        </Field>
        <Field label="Work email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@a.ae" required />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          New company?{' '}
          <a href="/signup" className="text-primary hover:underline">
            Start a free trial
          </a>
        </p>
      </form>
    </div>
  );
}
