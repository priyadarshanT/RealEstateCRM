import { BarChart3, Building2, CalendarDays, Clock, Landmark, Receipt, LayoutDashboard, MessagesSquare, Settings, Users, UserRound, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown when the user has any of these permissions (SRS §1: users only see what they may use). */
  anyOf: string[];
}

// Menu in the wireframe order (SRS §1).
export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, anyOf: ['leads.view'] },
  { href: '/leads', label: 'Leads', icon: UserRound, anyOf: ['leads.view'] },
  { href: '/tasks', label: 'Tasks & Calendar', icon: CalendarDays, anyOf: ['leads.view'] },
  { href: '/messages', label: 'WhatsApp & Email', icon: MessagesSquare, anyOf: ['messages.send', 'campaigns.create', 'campaigns.approve'] },
  { href: '/projects', label: 'Projects', icon: Landmark, anyOf: ['leads.view'] },
  { href: '/finance', label: 'Invoices & POs', icon: Receipt, anyOf: ['finance.create'] },
  { href: '/reports', label: 'Reports', icon: BarChart3, anyOf: ['leads.view', 'finance.create', 'attendance.view'] },
  { href: '/attendance', label: 'Attendance', icon: Clock, anyOf: ['attendance.view'] },
  { href: '/team', label: 'Team', icon: Users, anyOf: ['users.manage'] },
  { href: '/organization', label: 'Organization', icon: Building2, anyOf: ['settings.manage', 'billing.view'] },
  { href: '/configuration', label: 'Global Configuration', icon: Settings, anyOf: ['settings.manage', 'settings.view'] },
];
