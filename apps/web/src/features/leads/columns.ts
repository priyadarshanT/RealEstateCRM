// Lead list columns (SRS §2.10).

export const LEAD_COLUMNS = [
  { key: 'name', label: 'Name / Phone' },
  { key: 'email', label: 'Email' },
  { key: 'country', label: 'Country' },
  { key: 'project', label: 'Project' },
  { key: 'source', label: 'Source · Campaign' },
  { key: 'agent', label: 'Agent' },
  { key: 'priority', label: 'Priority' },
  { key: 'score', label: 'Score' },
  { key: 'stage', label: 'Stage' },
  { key: 'latestNote', label: 'Latest note' },
  { key: 'nextFollowUp', label: 'Next follow-up' },
  { key: 'createdAt', label: 'Created' },
] as const;

export type LeadColumnKey = (typeof LEAD_COLUMNS)[number]['key'];

export const DEFAULT_COLUMNS: LeadColumnKey[] = ['name', 'source', 'score', 'stage', 'nextFollowUp', 'agent'];

export const LEAD_TABS = [
  { key: 'all', label: 'All Leads' },
  { key: 'my', label: 'My Leads' },
  { key: 'shared', label: 'Shared with Me' },
  { key: 'team', label: 'Team Leads' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'deleted', label: 'Deleted' },
  { key: 'new', label: 'New' },
  { key: 'pending', label: 'Pending' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'cold', label: 'Cold' },
] as const;
