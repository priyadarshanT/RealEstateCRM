'use client';

import { Alert, Button, Loading, cn } from '@crm/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { errorMessage } from '@/core/api';
import { usePlatformMe } from './platform-api';

const NAV = [
  { href: '/console', label: 'Overview' },
  { href: '/console/billing', label: 'Billing' },
  { href: '/console/enquiries', label: 'Sales enquiries' },
  { href: '/console/plans', label: 'Plans & prices' },
  { href: '/console/audit', label: 'Audit log' },
];

/** Owner console (SRS §12): companies, income, billing and enquiries. Our team never sees a company's leads or messages. */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const me = usePlatformMe();
  const pathname = usePathname();
  if (me.isLoading) return <Loading />;
  if (me.error || !me.data) return <Alert className="m-6">{errorMessage(me.error)}</Alert>;

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-4 bg-slate-900 px-4 py-2.5 text-slate-200">
        <span className="font-semibold text-white">EstateCRM · Owner console</span>
        <nav className="flex flex-wrap gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn('rounded px-2.5 py-1 text-sm', (n.href === '/console' ? pathname === n.href : pathname.startsWith(n.href)) ? 'bg-white/15 text-white' : 'hover:bg-white/10')}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <span className="ml-auto text-xs">
          {me.data.fullName} · {me.data.role}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="border-slate-600 bg-transparent text-slate-200 hover:bg-white/10"
          onClick={async () => {
            // With Cognito the answer names its logout page, which ends that session too and comes back.
            const res = await fetch('/auth/platform-logout', { method: 'POST' });
            window.location.href = ((await res.json().catch(() => ({}))) as { redirect?: string }).redirect ?? '/console/login';
          }}
        >
          Sign out
        </Button>
      </header>
      <main className="p-4 md:p-5">{children}</main>
    </div>
  );
}
