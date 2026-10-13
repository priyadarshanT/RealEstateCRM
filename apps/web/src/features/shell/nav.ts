import { BarChart3, Building2, CalendarDays, LayoutDashboard, MessagesSquare, Settings, Users, UserRound, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown when the user has any of these permissions (SRS §1: users only see what they may use). */
  anyOf: string[];
}

// Menu in the wireframe order. Projects, Invoices & POs and Attendance (Phase 3) are added with their modules.
export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, anyOf: ['leads.view'] },
  { href: '/leads', label: 'Leads', icon: UserRound, anyOf: ['leads.view'] },
  { href: '/tasks', label: 'Tasks & Calendar', icon: CalendarDays, anyOf: ['leads.view'] },
  { href: '/messages', label: 'WhatsApp & Email', icon: MessagesSquare, anyOf: ['messages.send', 'campaigns.create', 'campaigns.approve'] },
  { href: '/reports', label: 'Reports', icon: BarChart3, anyOf: ['leads.view'] },
  { href: '/team', label: 'Team', icon: Users, anyOf: ['users.manage'] },
  { href: '/organization', label: 'Organization', icon: Building2, anyOf: ['settings.manage', 'billing.view'] },
  { href: '/settings', label: 'Settings & Integrations', icon: Settings, anyOf: ['settings.manage'] },
];
