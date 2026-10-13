'use client';

import { Alert, cn, Loading } from '@crm/ui';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '@/core/api';
import { useCan, useMe } from '@/core/session';
import { NAV } from './nav';
import { Topbar } from './topbar';

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const can = useCan();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  if (me.isLoading) return <Loading label="Signing you in…" />;
  if (me.error || !me.data) {
    return (
      <div className="p-6">
        <Alert>{errorMessage(me.error)}</Alert>
      </div>
    );
  }

  const items = NAV.filter((n) => n.anyOf.some(can));

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 w-60 shrink-0 bg-sidebar p-3 text-sidebar-foreground transition-transform md:static md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-5 flex items-center justify-between px-2 pt-1">
          <span className="text-base font-semibold text-white">
            ● Estate<span className="text-teal-300">CRM</span>
          </span>
          <button className="md:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
        <nav className="space-y-0.5">
          {items.map((n) => {
            const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-2.5 rounded-md border-l-2 px-2.5 py-2 text-sm',
                  active ? 'border-teal-300 bg-sidebar-active font-semibold text-white' : 'border-transparent hover:bg-white/5',
                )}
              >
                <n.icon className="size-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      {open ? <div className="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={() => setOpen(false)} /> : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          me={me.data}
          menuButton={
            <button className="md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu className="size-5" />
            </button>
          }
        />
        <main className="min-w-0 flex-1 p-4 md:p-5">{children}</main>
      </div>
    </div>
  );
}
