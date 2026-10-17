'use client';

import { Alert, Button, Loading } from '@crm/ui';
import { FileUp } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/core/api';
import { ImportDialog } from '@/features/leads/import-dialog';
import { TemplatesTab } from '@/features/messaging/templates-tab';
import { IntegrationTile, useIntegrations } from './integrations-section';
import { MarketingTab } from './marketing-tab';
import { SourcesCard } from './sources-reasons';
import { ConfigShell, Section } from './ui';

/** Global Configuration › Manage Source. */
export function SourcesPage() {
  return (
    <ConfigShell title="Manage Source" description="Manage lead sources and their quality score (used in the lead score).">
      <SourcesCard />
    </ConfigShell>
  );
}

/** Global Configuration › Manage Marketing: campaigns with daily ad spend, and events / roadshows. */
export function MarketingPage() {
  return (
    <ConfigShell title="Manage Marketing" description="Campaigns, ad spend and events used by the marketing reports.">
      <MarketingTab />
    </ConfigShell>
  );
}

/**
 * Global Configuration › Migration (§4). Today: the Excel / CSV lead import with column mapping, preview, checks
 * and a file of rejected rows. The template download, update-on-duplicate and batch retries follow.
 */
export function MigrationPage() {
  const [open, setOpen] = useState(false);
  return (
    <ConfigShell title="Migration" description="Import previous CRM leads and data">
      <Section title="Import leads from Excel or CSV" description="Map your columns to CRM fields, check a preview, then import. Duplicates are added to the existing lead as a re-enquiry; rejected rows come back as a file with the reason.">
        <Button onClick={() => setOpen(true)}>
          <FileUp className="size-4" /> Import leads
        </Button>
      </Section>
      <Section title="Coming next" description="From the Global Configuration document §4.">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Downloadable Excel template with status, substatus, owner, project and created date</li>
          <li>Choice to skip or update duplicates, with counts per batch</li>
          <li>Batch ID and safe retry without creating duplicates</li>
        </ul>
      </Section>
      <ImportDialog open={open} onOpenChange={setOpen} />
    </ConfigShell>
  );
}

/** Communication › Templates: email and WhatsApp templates with variables and approval status. */
export function TemplatesPage() {
  return (
    <ConfigShell title="Templates" description="Email and WhatsApp templates with variables and approval status. SMS templates arrive with an SMS provider.">
      <TemplatesTab />
    </ConfigShell>
  );
}

/** Communication › Email Configuration: the company email sender (provider, from address, reply-to, test). */
export function EmailPage() {
  const list = useIntegrations();
  return (
    <ConfigShell title="Email Configuration" description="The address the CRM sends email from. Signatures and reply-to follow the sender settings.">
      {list.isLoading ? <Loading /> : null}
      {list.error ? <Alert>{errorMessage(list.error)}</Alert> : null}
      <div className="max-w-md">
        <IntegrationTile
          card={{ key: 'email', name: 'Email sender', description: 'Company email for messages to leads', tab: 'others', mark: '@', tone: 'bg-sky-600 text-white', providers: ['email_ses'], connect: 'email' }}
          rows={(list.data ?? []).filter((i) => i.provider === 'email_ses')}
        />
      </div>
    </ConfigShell>
  );
}
