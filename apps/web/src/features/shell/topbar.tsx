'use client';

import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from '@crm/ui';
import type { ReactNode } from 'react';
import { initials } from '@/core/format';
import { logout, type Me } from '@/core/session';
import { GlobalSearch } from './global-search';
import { NotificationsBell } from './notifications-bell';

export function Topbar({ me, menuButton }: { me: Me; menuButton: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5">
      {menuButton}
      <GlobalSearch />
      <NotificationsBell />
      <Dropdown>
        <DropdownTrigger className="flex size-8 items-center justify-center rounded-full bg-amber-400 text-xs font-semibold text-amber-950" aria-label="Account">
          {initials(me.user.fullName)}
        </DropdownTrigger>
        <DropdownContent align="end">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{me.user.fullName}</p>
            <p className="text-xs text-muted-foreground">{me.user.email}</p>
            <p className="text-xs text-muted-foreground">{me.tenant.name}</p>
          </div>
          <DropdownSeparator />
          <DropdownItem onSelect={() => void logout()}>Sign out</DropdownItem>
        </DropdownContent>
      </Dropdown>
    </header>
  );
}
