'use client';

import { TabStrip } from '@crm/ui';
import { useState } from 'react';
import { HierarchyTab } from './hierarchy-tab';
import { RolesTab } from './roles-tab';
import { UsersTab } from './users-tab';

const TABS = [
  { key: 'users', label: 'Manage users' },
  { key: 'team', label: 'Manage team' },
  { key: 'roles', label: 'Roles & permissions' },
];

/** The Team menu has three parts (SRS §4). */
export function TeamScreen() {
  const [tab, setTab] = useState('users');
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Team › {TABS.find((t) => t.key === tab)?.label}</h1>
      <TabStrip items={TABS} value={tab} onChange={setTab} />
      {tab === 'users' ? <UsersTab /> : tab === 'team' ? <HierarchyTab /> : <RolesTab />}
    </div>
  );
}
