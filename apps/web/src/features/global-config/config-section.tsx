'use client';

import { EmptyState } from '@crm/ui';
import Link from 'next/link';
import { GeneralPage } from './general-page';
import { LeadsPage } from './leads-page';
import { SecurityPage } from './security-page';
import { EmailPage, MarketingPage, MigrationPage, SourcesPage, TemplatesPage } from './simple-pages';
import { StatusPage } from './status-page';

const PAGES: Record<string, () => React.ReactElement> = {
  general: GeneralPage,
  security: SecurityPage,
  leads: LeadsPage,
  status: StatusPage,
  sources: SourcesPage,
  marketing: MarketingPage,
  migration: MigrationPage,
  templates: TemplatesPage,
  email: EmailPage,
};

/** One Global Configuration detail page, by its address (/configuration/<section>). */
export function ConfigSection({ section }: { section: string }) {
  const Page = PAGES[section];
  if (!Page)
    return (
      <EmptyState title="Not available">
        <Link href="/configuration" className="text-primary hover:underline">
          Back to Global Configuration
        </Link>
      </EmptyState>
    );
  return <Page />;
}
