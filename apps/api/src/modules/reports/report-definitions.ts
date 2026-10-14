import { Principal } from '../../core/auth/principal';
import { LabelsService } from '../dashboard/labels.service';
import { EventsService } from '../events/events.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { CampaignsService } from '../messaging/campaigns.service';
import { dayAfter, dayStart } from '../../core/http/dates';
import { LeadReportingService, ReportFilters } from '../leads/lead-reporting.service';
import { MarketingService } from '../marketing/marketing.service';
import { TasksService } from '../tasks/tasks.service';

export interface ReportColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'money' | 'date' | 'datetime' | 'percent';
}

export interface ReportOutput {
  rows: Record<string, unknown>[];
  totals: Record<string, unknown>;
  /** Total number of rows when the report is paged. */
  total?: number;
}

export interface ReportDefinition {
  key: string;
  name: string;
  module: 'leads' | 'marketing' | 'performance' | 'events' | 'messaging' | 'integrations';
  /** Who may run it (any of these), when narrower than every report user (e.g. connection health for Admins). */
  permissions?: string[];
  /** Who may export it (SRS §8.9: Admin only by default). */
  exportPermission: 'leads.export' | 'reports.export';
  filters: string[];
  columns: ReportColumn[];
  paged: boolean;
  run(p: Principal, f: ReportFilters, limit: number, offset: number): Promise<ReportOutput>;
}

const FILTERS = ['from', 'to', 'projectId', 'sourceId', 'campaignId', 'teamId', 'userId'];
const money = (v: number) => v.toFixed(2);
const ratio = (amount: number, count: number) => (count > 0 ? money(amount / count) : null);
const iso = (d: Date | null) => d?.toISOString() ?? null;
const PROVIDER_LABEL: Record<string, string> = {
  meta: 'Meta lead ads',
  webhook: 'General webhook',
  website: 'Website',
  property_finder: 'Property Finder',
  bayut: 'Bayut',
  dubizzle: 'Dubizzle',
  whatsapp_cloud: 'WhatsApp',
  email_ses: 'Email sender',
  google_ads: 'Google Ads',
  linkedin: 'LinkedIn',
  snapchat: 'Snapchat',
  tiktok: 'TikTok',
};

interface Deps {
  reporting: LeadReportingService;
  tasks: TasksService;
  marketing: MarketingService;
  events: EventsService;
  labels: LabelsService;
  campaigns: CampaignsService;
  integrations: IntegrationsService;
}

/**
 * Reports (SRS §8.2–8.6): Phase 1 lead, marketing, performance and event reports; Phase 2 WhatsApp / email campaigns
 * and integration failures. Phase 3 reports (sales, invoices, attendance) are added with their modules.
 */
export function reportDefinitions(d: Deps): ReportDefinition[] {
  const leadColumns: ReportColumn[] = [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'text' },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'source', label: 'Source', type: 'text' },
    { key: 'campaign', label: 'Campaign', type: 'text' },
    { key: 'form', label: 'Form', type: 'text' },
    { key: 'agent', label: 'Agent', type: 'text' },
    { key: 'stage', label: 'Stage', type: 'text' },
    { key: 'reason', label: 'Reason', type: 'text' },
    { key: 'priority', label: 'Priority', type: 'text' },
    { key: 'score', label: 'Score', type: 'number' },
    { key: 'enquiries', label: 'Enquiries', type: 'number' },
    { key: 'nextFollowUp', label: 'Next follow-up', type: 'datetime' },
    { key: 'createdAt', label: 'Created', type: 'datetime' },
  ];

  const leadList = (key: string, name: string, preset: Parameters<LeadReportingService['preset']>[0]): ReportDefinition => ({
    key,
    name,
    module: 'leads',
    exportPermission: 'leads.export',
    filters: FILTERS,
    columns: leadColumns,
    paged: true,
    async run(p, f, limit, offset) {
      const { rows, total } = await d.reporting.leadRows(p, f, await d.reporting.preset(preset), limit, offset);
      const [sources, campaigns, users, stages, reasons] = await Promise.all([
        d.labels.sources(rows.map((r) => r.sourceId)),
        d.labels.campaigns(rows.map((r) => r.campaignId ?? '')),
        d.labels.users(rows.map((r) => r.ownerUserId ?? '')),
        d.labels.stages(rows.map((r) => r.stageId)),
        d.labels.reasons(rows.map((r) => r.closeReasonId ?? '')),
      ]);
      return {
        rows: rows.map((r) => ({
          id: r.id,
          name: r.fullName,
          phone: r.phonePrimary,
          email: r.email,
          source: sources.get(r.sourceId) ?? null,
          campaign: r.campaignId ? (campaigns.get(r.campaignId) ?? null) : null,
          form: r.formName,
          agent: r.ownerUserId ? (users.get(r.ownerUserId) ?? null) : 'Unassigned',
          stage: stages.get(r.stageId) ?? null,
          reason: r.closeReasonId ? (reasons.get(r.closeReasonId) ?? null) : null,
          priority: r.priority,
          score: r.score,
          enquiries: r.enquiryCount,
          nextFollowUp: iso(r.nextFollowUpAt),
          createdAt: iso(r.createdAt),
        })),
        totals: { leads: total },
        total,
      };
    },
  });

  const grouped = (key: string, name: string, dimension: 'source' | 'project' | 'campaign' | 'form' | 'stage', labelOf: (ids: string[]) => Promise<Map<string, string>>): ReportDefinition => ({
    key,
    name,
    module: 'leads',
    exportPermission: 'leads.export',
    filters: FILTERS,
    columns: [
      { key: 'label', label: name.replace('Leads by ', ''), type: 'text' },
      { key: 'leads', label: 'Leads', type: 'number' },
      { key: 'share', label: 'Share', type: 'percent' },
    ],
    paged: false,
    async run(p, f) {
      const buckets = await d.reporting.groupBy(p, f, dimension);
      const labels = await labelOf(buckets.map((b) => b.key).filter((k) => k !== 'none'));
      const total = buckets.reduce((n, b) => n + b.count, 0);
      return {
        rows: buckets.map((b) => ({ key: b.key, label: b.key === 'none' ? '(none)' : (labels.get(b.key) ?? b.key), leads: b.count, share: total ? Math.round((b.count / total) * 1000) / 10 : 0 })),
        totals: { leads: total },
      };
    },
  });

  return [
    leadList('leads', 'All leads', 'all'),
    leadList('leads_new', 'New leads', 'new'),
    leadList('leads_pending', 'Pending leads', 'pending'),
    leadList('leads_scheduled', 'Scheduled leads', 'scheduled'),
    leadList('leads_overdue', 'Overdue leads', 'overdue'),
    leadList('leads_untouched', 'Untouched leads', 'untouched'),
    leadList('leads_lost', 'Lost and invalid leads', 'lost'),
    leadList('re_enquiries', 'Re-enquiries', 're_enquiries'),
    grouped('leads_by_source', 'Leads by source', 'source', (ids) => d.labels.sources(ids)),
    grouped('leads_by_project', 'Leads by project', 'project', async (ids) => new Map(ids.map((i) => [i, i]))),
    grouped('leads_by_campaign', 'Leads by campaign', 'campaign', (ids) => d.labels.campaigns(ids)),
    grouped('leads_by_form', 'Leads by form', 'form', async (ids) => new Map(ids.map((i) => [i, i]))),
    grouped('leads_by_stage', 'Leads by stage', 'stage', (ids) => d.labels.stages(ids)),
    {
      key: 'marketing',
      name: 'Marketing: spend and cost per lead',
      module: 'marketing',
      exportPermission: 'reports.export',
      filters: FILTERS,
      columns: [
        { key: 'campaign', label: 'Campaign', type: 'text' },
        { key: 'leads', label: 'Leads', type: 'number' },
        { key: 'qualified', label: 'Qualified', type: 'number' },
        { key: 'spend', label: 'Spend', type: 'money' },
        { key: 'costPerLead', label: 'Cost per lead', type: 'money' },
        { key: 'costPerQualified', label: 'Cost per qualified lead', type: 'money' },
      ],
      paged: false,
      async run(p, f) {
        const [byCampaign, spend] = await Promise.all([d.reporting.byCampaignOrEvent(p, f, 'campaign'), d.marketing.spendByCampaign(f.from, f.to)]);
        const spendOf = new Map<string, number>();
        for (const s of spend) spendOf.set(s.campaignId, (spendOf.get(s.campaignId) ?? 0) + Number(s.amount));
        const ids = [...new Set([...byCampaign.map((c) => c.key!), ...(f.campaignId ? [f.campaignId] : [...spendOf.keys()])])];
        const names = await d.labels.campaigns(ids);
        const rows = ids.map((id) => {
          const c = byCampaign.find((x) => x.key === id);
          const amount = spendOf.get(id) ?? 0;
          return {
            campaignId: id,
            campaign: names.get(id) ?? id,
            leads: c?.leads ?? 0,
            qualified: c?.qualified ?? 0,
            spend: money(amount),
            costPerLead: ratio(amount, c?.leads ?? 0),
            costPerQualified: ratio(amount, c?.qualified ?? 0),
          };
        });
        const leads = rows.reduce((n, r) => n + r.leads, 0);
        const qualified = rows.reduce((n, r) => n + r.qualified, 0);
        const spent = rows.reduce((n, r) => n + Number(r.spend), 0);
        return { rows, totals: { leads, qualified, spend: money(spent), costPerLead: ratio(spent, leads), costPerQualified: ratio(spent, qualified) } };
      },
    },
    {
      key: 'agent_performance',
      name: 'Agent performance',
      module: 'performance',
      exportPermission: 'reports.export',
      filters: FILTERS,
      columns: [
        { key: 'agent', label: 'Agent', type: 'text' },
        { key: 'leads', label: 'Leads', type: 'number' },
        { key: 'contacted', label: 'Contacted', type: 'number' },
        { key: 'qualified', label: 'Qualified', type: 'number' },
        { key: 'won', label: 'Won', type: 'number' },
        { key: 'calls', label: 'Calls', type: 'number' },
        { key: 'avgResponseMinutes', label: 'Avg. response (min)', type: 'number' },
        { key: 'missed', label: 'Missed (10-minute rule)', type: 'number' },
      ],
      paged: false,
      async run(p, f) {
        const [perf, calls] = await Promise.all([
          d.reporting.agentPerformance(p, f),
          d.tasks.callOutcomes(p, f.from ? dayStart(f.from) : undefined, f.to ? dayAfter(f.to) : undefined, f.userId),
        ]);
        const callsOf = new Map<string, number>();
        for (const c of calls) callsOf.set(c.userId, (callsOf.get(c.userId) ?? 0) + c.count);
        const names = await d.labels.users(perf.map((r) => r.userId!));
        const rows = perf.map((r) => ({ userId: r.userId, agent: names.get(r.userId!) ?? r.userId, leads: r.leads, contacted: r.contacted, qualified: r.qualified, won: r.won, calls: callsOf.get(r.userId!) ?? 0, avgResponseMinutes: r.avgResponseMinutes, missed: r.missed }));
        const sum = (k: 'leads' | 'contacted' | 'qualified' | 'won' | 'calls' | 'missed') => rows.reduce((n, r) => n + r[k], 0);
        return { rows, totals: { leads: sum('leads'), contacted: sum('contacted'), qualified: sum('qualified'), won: sum('won'), calls: sum('calls'), missed: sum('missed') } };
      },
    },
    {
      key: 'call_outcomes',
      name: 'Call outcomes',
      module: 'performance',
      exportPermission: 'reports.export',
      filters: ['from', 'to', 'userId'],
      columns: [
        { key: 'agent', label: 'Agent', type: 'text' },
        { key: 'answered', label: 'Answered', type: 'number' },
        { key: 'no_answer', label: 'No answer', type: 'number' },
        { key: 'busy', label: 'Busy', type: 'number' },
        { key: 'wrong_number', label: 'Wrong number', type: 'number' },
        { key: 'call_back', label: 'Call back', type: 'number' },
        { key: 'total', label: 'Total', type: 'number' },
      ],
      paged: false,
      async run(p, f) {
        const calls = await d.tasks.callOutcomes(p, f.from ? dayStart(f.from) : undefined, f.to ? dayAfter(f.to) : undefined, f.userId);
        const names = await d.labels.users(calls.map((c) => c.userId));
        const byUser = new Map<string, Record<string, unknown>>();
        for (const c of calls) {
          const row = byUser.get(c.userId) ?? { userId: c.userId, agent: names.get(c.userId) ?? c.userId, answered: 0, no_answer: 0, busy: 0, wrong_number: 0, call_back: 0, total: 0 };
          row[c.outcome ?? 'answered'] = (row[c.outcome ?? 'answered'] as number) + c.count;
          row.total = (row.total as number) + c.count;
          byUser.set(c.userId, row);
        }
        const rows = [...byUser.values()];
        const totals: Record<string, number> = { answered: 0, no_answer: 0, busy: 0, wrong_number: 0, call_back: 0, total: 0 };
        for (const r of rows) for (const k of Object.keys(totals)) totals[k]! += r[k] as number;
        return { rows, totals };
      },
    },
    {
      key: 'funnel',
      name: 'Lead funnel',
      module: 'performance',
      exportPermission: 'reports.export',
      filters: FILTERS,
      columns: [
        { key: 'step', label: 'Step', type: 'text' },
        { key: 'leads', label: 'Leads', type: 'number' },
        { key: 'conversion', label: 'From previous step', type: 'percent' },
      ],
      paged: false,
      async run(p, f) {
        const steps = await d.reporting.funnel(p, f);
        const rows = steps.map((s, i) => {
          const prev = i ? steps[i - 1]!.count : s.count;
          return { key: s.key, step: s.label, leads: s.count, conversion: prev ? Math.round((s.count / prev) * 1000) / 10 : 0 };
        });
        return { rows, totals: { leads: steps[0]?.count ?? 0, sales: steps[steps.length - 1]?.count ?? 0 } };
      },
    },
    {
      key: 'events',
      name: 'Events and roadshows',
      module: 'events',
      exportPermission: 'reports.export',
      filters: FILTERS,
      columns: [
        { key: 'event', label: 'Event', type: 'text' },
        { key: 'type', label: 'Type', type: 'text' },
        { key: 'startsAt', label: 'Date', type: 'datetime' },
        { key: 'leads', label: 'Leads', type: 'number' },
        { key: 'meetings', label: 'Meetings', type: 'number' },
        { key: 'bookings', label: 'Bookings', type: 'number' },
        { key: 'cost', label: 'Cost', type: 'money' },
        { key: 'costPerLead', label: 'Cost per lead', type: 'money' },
      ],
      paged: false,
      async run(p, f) {
        const counts = await d.reporting.byCampaignOrEvent(p, { ...f, from: undefined, to: undefined }, 'event');
        // Every event in the period, with the leads tagged to it (also events without leads yet).
        const inPeriod = await d.events.inPeriod(f.from ? dayStart(f.from) : undefined, f.to ? dayAfter(f.to) : undefined);
        const rows = inPeriod.map((e) => {
          const c = counts.find((x) => x.key === e.id);
          const cost = e.cost === null ? null : Number(e.cost);
          return {
            eventId: e.id,
            event: e.name,
            type: e.type,
            startsAt: iso(e.startsAt),
            leads: c?.leads ?? 0,
            meetings: c?.meetings ?? 0,
            bookings: c?.bookings ?? 0,
            cost: cost === null ? null : money(cost),
            costPerLead: cost === null ? null : ratio(cost, c?.leads ?? 0),
          };
        });
        const leads = rows.reduce((n, r) => n + r.leads, 0);
        const cost = rows.reduce((n, r) => n + Number(r.cost ?? 0), 0);
        return { rows, totals: { leads, meetings: rows.reduce((n, r) => n + r.meetings, 0), bookings: rows.reduce((n, r) => n + r.bookings, 0), cost: money(cost), costPerLead: ratio(cost, leads) } };
      },
    },
    {
      key: 'message_campaigns',
      name: 'WhatsApp and email campaigns',
      module: 'messaging',
      permissions: ['campaigns.create', 'campaigns.approve', 'settings.manage'],
      exportPermission: 'reports.export',
      filters: ['from', 'to'],
      columns: [
        { key: 'campaign', label: 'Campaign', type: 'text' },
        { key: 'channel', label: 'Channel', type: 'text' },
        { key: 'startedAt', label: 'Sent on', type: 'datetime' },
        { key: 'audience', label: 'Audience', type: 'number' },
        { key: 'sent', label: 'Sent', type: 'number' },
        { key: 'delivered', label: 'Delivered', type: 'number' },
        { key: 'failed', label: 'Failed', type: 'number' },
        { key: 'replied', label: 'Replied', type: 'number' },
        { key: 'optedOut', label: 'Opted out', type: 'number' },
        { key: 'deliveryRate', label: 'Delivered of sent', type: 'percent' },
      ],
      paged: false,
      async run(_p, f) {
        const list = await d.campaigns.summary(f.from ? dayStart(f.from) : undefined, f.to ? dayAfter(f.to) : undefined);
        const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
        const rows = list.map((c) => ({
          campaignId: c.campaignId,
          campaign: c.name,
          channel: c.channel === 'whatsapp' ? 'WhatsApp' : 'Email',
          startedAt: iso(c.startedAt),
          audience: c.audience,
          sent: c.sent,
          delivered: c.delivered,
          failed: c.failed,
          replied: c.replied,
          optedOut: c.optedOut,
          deliveryRate: pct(c.delivered, c.sent),
        }));
        const sum = (k: 'audience' | 'sent' | 'delivered' | 'failed' | 'replied' | 'optedOut') => rows.reduce((n, r) => n + r[k], 0);
        return {
          rows,
          totals: { audience: sum('audience'), sent: sum('sent'), delivered: sum('delivered'), failed: sum('failed'), replied: sum('replied'), optedOut: sum('optedOut'), deliveryRate: pct(sum('delivered'), sum('sent')) },
        };
      },
    },
    {
      key: 'integration_failures',
      name: 'Integration failures',
      module: 'integrations',
      permissions: ['settings.manage'],
      exportPermission: 'reports.export',
      filters: ['from', 'to'],
      columns: [
        { key: 'connection', label: 'Connection', type: 'text' },
        { key: 'account', label: 'Account', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'received', label: 'Received', type: 'number' },
        { key: 'processed', label: 'Imported', type: 'number' },
        { key: 'retrying', label: 'Retrying', type: 'number' },
        { key: 'failed', label: 'Failed', type: 'number' },
        { key: 'lastError', label: 'Last error', type: 'text' },
        { key: 'lastErrorAt', label: 'Last error at', type: 'datetime' },
      ],
      paged: false,
      async run(_p, f) {
        const list = await d.integrations.failureSummary(f.from ? dayStart(f.from) : undefined, f.to ? dayAfter(f.to) : undefined);
        const rows = list.map((i) => ({
          integrationId: i.integrationId,
          connection: PROVIDER_LABEL[i.provider] ?? i.provider,
          account: i.accountLabel,
          status: i.status,
          received: i.received,
          processed: i.processed,
          retrying: i.retrying,
          failed: i.failed,
          lastError: i.lastError,
          lastErrorAt: iso(i.lastErrorAt),
        }));
        const sum = (k: 'received' | 'processed' | 'retrying' | 'failed') => rows.reduce((n, r) => n + r[k], 0);
        return { rows, totals: { received: sum('received'), processed: sum('processed'), retrying: sum('retrying'), failed: sum('failed') } };
      },
    },
  ];
}
