'use client';

import { Alert, Card, CardBody, CardHeader, EmptyState, Loading, Select, StatCard } from '@crm/ui';
import { Chart } from '@crm/ui/chart';
import type { Schemas } from '@crm/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ChartOption as EChartsOption } from '@crm/ui/chart';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { DATE_PRESETS, presetRange, type DatePreset } from '@/core/date-range';
import { formatDateTime, formatMoneyShort } from '@/core/format';
import { useCampaigns, useTeams, useUsers } from '@/core/lookups';
import { useCan, useMe } from '@/core/session';
import { barOption, funnelOption, pieOption, trendOption } from './dashboard-charts';

type Bucket = Schemas['CountBucket'];

/**
 * Dashboard (SRS §10): number cards, pies by source/project/stage, funnel, bars by agent/project/campaign and trends.
 * Each role sees its own data (the API applies the data scope). Click a number or a slice to open the leads behind it.
 */
export function DashboardScreen() {
  const router = useRouter();
  const can = useCan();
  const me = useMe();
  const users = useUsers();
  const teams = useTeams();
  const campaigns = useCampaigns();
  const [preset, setPreset] = useState<DatePreset>('thisMonth');
  const [teamId, setTeamId] = useState('');
  const [userId, setUserId] = useState('');
  const [campaignId, setCampaignId] = useState('');

  const query = useMemo(() => {
    const { from, to } = presetRange(preset);
    return { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(teamId ? { teamId } : {}), ...(userId ? { userId } : {}), ...(campaignId ? { campaignId } : {}) };
  }, [preset, teamId, userId, campaignId]);

  const dash = useQuery({
    queryKey: ['dashboard', query],
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60_000,
    queryFn: async () => unwrap(await api.GET('/dashboard', { params: { query } })),
  });

  /** Opens the lead list with the dashboard filters plus the clicked bucket. */
  const openLeads = (extra: Record<string, unknown> = {}) => {
    const p = new URLSearchParams();
    if (teamId) p.set('teamId', teamId);
    if (userId) p.set('ownerUserId', userId);
    if (campaignId) p.set('campaignId', campaignId);
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
    router.push(`/leads?${p.toString()}`);
  };
  const drill = (buckets: Bucket[]) => (i: number) => buckets[i] && openLeads(buckets[i].drillDown as Record<string, unknown>);

  const k = dash.data?.kpis;
  const cards: { label: string; value: React.ReactNode; accent: string; onClick?: () => void }[] = k
    ? [
        { label: 'Total leads', value: (k.total ?? 0).toLocaleString(), accent: '#3b6fe0', onClick: () => openLeads({ tab: 'all' }) },
        { label: 'New', value: (k.new ?? 0).toLocaleString(), accent: '#3b6fe0', onClick: () => openLeads({ tab: 'new' }) },
        { label: 'Untouched', value: <span className="text-danger">{k.untouched ?? 0}</span>, accent: '#c62828', onClick: () => openLeads({ tab: 'pending' }) },
        { label: 'Overdue', value: <span className="text-danger">{k.overdue ?? 0}</span>, accent: '#c62828', onClick: () => openLeads({ tab: 'overdue' }) },
        { label: 'Re-enquired', value: (k.reEnquired ?? 0).toLocaleString(), accent: '#f2b33d' },
        { label: 'Meetings today', value: k.meetingsToday ?? 0, accent: '#15803d', onClick: () => router.push('/tasks') },
        { label: 'Hot leads', value: (k.qualified ?? 0).toLocaleString(), accent: '#e11d48' },
        { label: 'EOIs', value: k.eois ?? 0, accent: '#8b5cf6' },
        { label: 'Bookings', value: k.bookings ?? 0, accent: '#8b5cf6' },
        { label: 'Sales value', value: formatMoneyShort(k.salesValue, me.data?.tenant.baseCurrency), accent: '#15803d' },
        { label: 'Unpaid invoices', value: formatMoneyShort(k.unpaidInvoices, me.data?.tenant.baseCurrency), accent: '#f2b33d' },
      ]
    : [];

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Dashboard</h1>
      <div className="flex flex-wrap gap-2">
        <Select className="h-8 w-auto text-xs" value={preset} onChange={(e) => setPreset(e.target.value as DatePreset)} aria-label="Period">
          {DATE_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </Select>
        {can('users.manage') ? (
          <>
            <Select className="h-8 w-auto text-xs" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Team">
              <option value="">All teams</option>
              {teams.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Select className="h-8 w-auto text-xs" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Agent">
              <option value="">All agents</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
          </>
        ) : null}
        <Select className="h-8 w-auto text-xs" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Campaign">
          <option value="">All campaigns</option>
          {campaigns.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      {dash.error ? <Alert>{errorMessage(dash.error)}</Alert> : null}
      {dash.isLoading ? <Loading /> : null}
      {dash.data ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {cards.map((c) => (
              <StatCard key={c.label} label={c.label} value={c.value} accent={c.accent} onClick={c.onClick} />
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <ChartCard title="Leads by source" buckets={dash.data.bySource} option={pieOption(dash.data.bySource ?? [])} onClick={drill(dash.data.bySource ?? [])} />
            <ChartCard title="Funnel" buckets={dash.data.funnel} option={funnelOption(dash.data.funnel)} />
            <ChartCard title="Leads by agent" buckets={dash.data.byAgent} option={barOption(dash.data.byAgent ?? [])} onClick={drill(dash.data.byAgent ?? [])} />
            <ChartCard title="Leads by status" buckets={dash.data.byStage} option={pieOption(dash.data.byStage ?? [])} onClick={drill(dash.data.byStage ?? [])} />
            <ChartCard title="Leads by project" buckets={dash.data.byProject} option={pieOption(dash.data.byProject ?? [])} onClick={drill(dash.data.byProject ?? [])} />
            <ChartCard
              title="Leads by campaign"
              buckets={dash.data.byCampaign}
              option={barOption(dash.data.byCampaign ?? [], '#0f8a7e')}
              onClick={drill(dash.data.byCampaign ?? [])}
            />
          </div>
          <Card>
            <CardHeader title="Leads, hot leads, spend and sales over time" />
            <CardBody>{(dash.data.trend ?? []).length ? <Chart option={trendOption(dash.data.trend)} className="h-64" /> : <EmptyState title="No data for this period" />}</CardBody>
          </Card>
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Click any number to open the leads behind it. Figures are at most 5 minutes old (updated {formatDateTime(dash.data.refreshedAt, me.data?.user.timezone)}).
          </p>
        </>
      ) : null}
    </div>
  );
}

function ChartCard({ title, buckets, option, onClick }: { title: string; buckets: Bucket[] | undefined; option: EChartsOption; onClick?: (i: number) => void }) {
  const empty = !buckets || buckets.every((b) => b.count === 0);
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>{empty ? <EmptyState title="No data for this period" /> : <Chart option={option} onClickItem={onClick} />}</CardBody>
    </Card>
  );
}
