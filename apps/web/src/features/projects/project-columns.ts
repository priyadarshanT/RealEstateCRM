import type { Schemas } from '@crm/contracts';
import type { ColumnOption } from '@/features/list-tools/manage-columns';

// Project page columns (stakeholder update 2026-10-17, Project page §2): keys match POST /project-exports;
// custom fields are added as `cf:<key>`.

export const PROJECT_COLUMNS: ColumnOption[] = [
  { key: 'availability', label: 'Availability' },
  { key: 'name', label: 'Project Name', locked: true },
  { key: 'assignedTo', label: 'Assigned To' },
  { key: 'category', label: 'Project Type' },
  { key: 'status', label: 'Status' },
  { key: 'leadCount', label: 'Lead Count' },
  { key: 'developer', label: 'Developer' },
  { key: 'city', label: 'City' },
  { key: 'location', label: 'Location' },
  { key: 'startingPrice', label: 'Starting Price' },
  { key: 'currency', label: 'Currency' },
  { key: 'paymentPlan', label: 'Payment Plan' },
  { key: 'handoverDate', label: 'Handover Date' },
  { key: 'createdAt', label: 'Created Date' },
  { key: 'updatedAt', label: 'Updated Date' },
  { key: 'notes', label: 'Notes' },
];

export const DEFAULT_PROJECT_COLUMNS = ['availability', 'name', 'assignedTo', 'category', 'status', 'leadCount'];

export const CATEGORY_TABS = [
  { key: 'all', label: 'All' },
  { key: 'residential', label: 'Residential' },
  { key: 'commercial', label: 'Commercial' },
  { key: 'agricultural', label: 'Agricultural' },
] as const;

export const CATEGORY_LABEL: Record<NonNullable<Schemas['Project']['category']>, string> = { residential: 'Residential', commercial: 'Commercial', agricultural: 'Agricultural' };

export const PROJECT_DATE_FIELDS = [
  { key: 'created', label: 'Created Date' },
  { key: 'updated', label: 'Updated Date' },
  { key: 'handover', label: 'Handover Date' },
];

export type CustomField = Schemas['ProjectCustomField'];

/** All columns: built-in ones, then the active custom fields. */
export function allProjectColumns(fields: CustomField[] | undefined): ColumnOption[] {
  return [...PROJECT_COLUMNS, ...(fields ?? []).filter((f) => f.isActive).map((f) => ({ key: `cf:${f.key}`, label: f.label }))];
}
