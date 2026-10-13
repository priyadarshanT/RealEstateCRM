'use client';

import { TabStrip } from '@crm/ui';
import { useState } from 'react';
import { useCan } from '@/core/session';
import { BillingTab } from './billing-tab';
import { ProfileTab } from './profile-tab';

/** Organization profile, with Billing for the Admin (SRS §1.1, §12). */
export function OrganizationScreen() {
  const can = useCan();
  const tabs = [{ key: 'profile', label: 'Profile' }, ...(can('billing.view') ? [{ key: 'billing', label: 'Billing' }] : [])];
  const [tab, setTab] = useState('profile');
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Organization › {tab === 'billing' ? 'Billing' : 'Profile'}</h1>
      <TabStrip items={tabs} value={tab} onChange={setTab} />
      {tab === 'billing' ? <BillingTab /> : <ProfileTab />}
    </div>
  );
}
