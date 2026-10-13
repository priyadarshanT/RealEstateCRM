'use client';

import { TabStrip } from '@crm/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { AssignmentTab } from './assignment-tab';
import { ConnectionsTab } from './connections-tab';
import { LeadConfigTab } from './lead-config-tab';
import { MarketingTab } from './marketing-tab';
import { RulesTab } from './rules-tab';

// Phase 1 settings (SRS §11.5). Templates (Phase 2) and invoice numbering (Phase 3) arrive with their modules.
const TABS = [
  { key: 'connections', label: 'Connections' },
  { key: 'stages', label: 'Stages, reasons & sources' },
  { key: 'assignment', label: 'Assignment' },
  { key: 'rules', label: 'Response time, scoring & currency' },
  { key: 'marketing', label: 'Campaigns & events' },
];

export function SettingsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab')! : 'connections';

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Settings & Integrations</h1>
      <TabStrip items={TABS} value={tab} onChange={(k) => router.replace(`/settings?tab=${k}`)} />
      {tab === 'connections' ? <ConnectionsTab /> : null}
      {tab === 'stages' ? <LeadConfigTab /> : null}
      {tab === 'assignment' ? <AssignmentTab /> : null}
      {tab === 'rules' ? <RulesTab /> : null}
      {tab === 'marketing' ? <MarketingTab /> : null}
    </div>
  );
}
