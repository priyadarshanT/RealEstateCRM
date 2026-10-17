'use client';

import { cn } from '@crm/ui';
import { ChevronRight, Settings } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { COMMUNICATION, HUB_TABS, MODULES } from './catalog';
import { IntegrationsSection } from './integrations-section';
import { EditGate, useCanEditConfig, ViewOnlyNotice } from './ui';

/**
 * Global Configuration (replaces Settings & Integrations, stakeholder update 2026-10-17): Module Settings,
 * Integration and Communication. Cards open their detail page; modules without an agreed scope are marked
 * "Not available yet" and do nothing.
 */
export function ConfigHub() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = HUB_TABS.some((t) => t.key === params.get('tab')) ? (params.get('tab') as (typeof HUB_TABS)[number]['key']) : 'modules';
  const canEdit = useCanEditConfig();

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Settings className="size-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Global Configuration</h1>
          <p className="text-sm text-muted-foreground">Company-wide settings, integrations and communication. Only the Admin can change them.</p>
        </div>
      </div>

      {canEdit ? null : <ViewOnlyNotice />}

      <div role="tablist" className="flex gap-1 border-b border-border">
        {HUB_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => router.replace(`/configuration?tab=${t.key}`)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'modules' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m) => (
            <Tile key={m.key} href={m.href} title={m.title} description={m.description} icon={<m.icon className="size-5" />} tone={m.tone} />
          ))}
        </div>
      ) : null}
      {tab === 'integrations' ? (
        <EditGate>
          <IntegrationsSection />
        </EditGate>
      ) : null}
      {tab === 'communication' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {COMMUNICATION.map((c) => (
            <Tile key={c.key} href={c.href} title={c.title} description={c.description} icon={<c.icon className="size-5" />} tone={c.tone} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A wide rounded card; the whole card is the link. Without a link it is shown as not available yet. */
function Tile({ href, title, description, icon, tone }: { href?: string; title: string; description: string; icon: ReactNode; tone: string }) {
  const body = (
    <>
      <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-full', tone)}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-foreground">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
        {!href ? <span className="mt-1.5 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Not available yet</span> : null}
      </span>
      {href ? <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" /> : null}
    </>
  );
  const cls = 'group flex min-h-24 items-center gap-3 rounded-2xl border border-slate-200 bg-surface p-4 text-left shadow-sm transition';
  return href ? (
    <Link href={href} className={cn(cls, 'hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40')}>
      {body}
    </Link>
  ) : (
    <div aria-disabled className={cn(cls, 'cursor-default opacity-75')}>
      {body}
    </div>
  );
}
