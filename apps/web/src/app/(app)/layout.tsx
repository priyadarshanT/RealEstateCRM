import type { ReactNode } from 'react';
import { SecurityGuard } from '@/features/global-config/security-page';
import { AppShell } from '@/features/shell/app-shell';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <SecurityGuard />
      {children}
    </AppShell>
  );
}
