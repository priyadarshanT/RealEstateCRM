'use client';

import { TabStrip } from '@crm/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { AssignmentTab } from './assignment-tab';
import { ConnectionsTab } from './connections-tab';
import { LeadConfigTab } from './lead-config-tab';
import { TemplatesTab } from '@/features/messaging/templates-tab';
import { MarketingTab } from './marketing-tab';
import { RulesTab } from './rules-tab';

// Settings (SRS §11.5). Invoice numbering (Phase 3) arrives with the finance module.
const TABS = [
  { key: 'connections', label: 'Connections' },
  { key: 'stages', label: 'Stages, reasons & sources' },
  { key: 'assignment', label: 'Assignment' },
  { key: 'rules', label: 'Response time, scoring & currency' },
  { key: 'templates', label: 'Templates' },
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
      {tab === 'templates' ? <TemplatesTab /> : null}
      {tab === 'marketing' ? <MarketingTab /> : null}
    </div>
  );
}
