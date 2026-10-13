import { BarChart3, Building2, CalendarDays, LayoutDashboard, Settings, Users, UserRound, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown when the user has any of these permissions (SRS §1: users only see what they may use). */
  anyOf: string[];
}

// Phase 1 menu. WhatsApp & Email (Phase 2), Projects, Invoices & POs and Attendance (Phase 3) are added with their modules.
export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, anyOf: ['leads.view'] },
  { href: '/leads', label: 'Leads', icon: UserRound, anyOf: ['leads.view'] },
  { href: '/tasks', label: 'Tasks & Calendar', icon: CalendarDays, anyOf: ['leads.view'] },
  { href: '/reports', label: 'Reports', icon: BarChart3, anyOf: ['leads.view'] },
  { href: '/team', label: 'Team', icon: Users, anyOf: ['users.manage'] },
  { href: '/organization', label: 'Organization', icon: Building2, anyOf: ['settings.manage', 'billing.view'] },
  { href: '/settings', label: 'Settings & Integrations', icon: Settings, anyOf: ['settings.manage'] },
];
