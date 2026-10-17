// Lead list columns (SRS §2.10).

// Manage Columns (Lead page §7): keys match the Excel export columns (POST /lead-exports).
export const LEAD_COLUMNS = [
  { key: 'name', label: 'Name / Phone', locked: true },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'stage', label: 'Status' },
  { key: 'substatus', label: 'Substatus' },
  { key: 'project', label: 'Project' },
  { key: 'agent', label: 'Assigned To' },
  { key: 'secondaryOwner', label: 'Secondary Owner' },
  { key: 'assignedFrom', label: 'Assigned From' },
  { key: 'reassignedBy', label: 'Reassigned By' },
  { key: 'reassignedAt', label: 'Reassigned At' },
  { key: 'latestNote', label: 'Note' },
  { key: 'country', label: 'Country' },
  { key: 'city', label: 'City' },
  { key: 'source', label: 'Source' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'priority', label: 'Priority' },
  { key: 'score', label: 'Score' },
  { key: 'nextFollowUp', label: 'Next Follow-up' },
  { key: 'createdAt', label: 'Created' },
] as const;

export type LeadColumnKey = (typeof LEAD_COLUMNS)[number]['key'];

export const DEFAULT_COLUMNS: LeadColumnKey[] = ['name', 'stage', 'substatus', 'source', 'agent', 'nextFollowUp', 'score'];

/** Dates the Calendar / Date Range can filter (Lead page §8.3). */
export const LEAD_DATE_FIELDS = [
  { key: 'created', label: 'Lead Created Date' },
  { key: 'follow_up', label: 'Follow-up Date' },
  { key: 'appointment', label: 'Appointment Date' },
  { key: 'sale_done', label: 'Sale Done Date' },
];

export const STATUS_TABS = ['hot', 'warm', 'cold', 'sale_done'];

export const LEAD_TABS = [
  { key: 'all', label: 'All Leads' },
  { key: 'my', label: 'My Leads' },
  { key: 'shared', label: 'Shared with Me' },
  { key: 'team', label: 'Team Leads' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'deleted', label: 'Deleted' },
  { key: 'hot', label: 'Hot' },
  { key: 'warm', label: 'Warm' },
  { key: 'cold', label: 'Cold' },
  { key: 'sale_done', label: 'Sale Done' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'overdue', label: 'Overdue' },
] as const;
