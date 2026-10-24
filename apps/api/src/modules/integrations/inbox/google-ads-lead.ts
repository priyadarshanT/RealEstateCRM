// Google Ads lead form extensions (webhook delivery): one lead per POST, answers in user_column_data.

interface GoogleColumn {
  column_id?: string;
  column_name?: string;
  string_value?: string;
}

/** Google's standard question IDs → names the field mapping already knows (field-mapping.ts DEFAULT_NAMES). */
const COLUMN_NAMES: Record<string, string> = {
  FULL_NAME: 'full_name',
  FIRST_NAME: 'first_name',
  LAST_NAME: 'last_name',
  PHONE_NUMBER: 'phone',
  WORK_PHONE: 'alternate_phone',
  EMAIL: 'email',
  WORK_EMAIL: 'work_email',
  CITY: 'city',
  COUNTRY: 'country',
  REGION: 'region',
  POSTAL_CODE: 'postal_code',
  STREET_ADDRESS: 'street_address',
  COMPANY_NAME: 'company_name',
  JOB_TITLE: 'job_title',
};

/**
 * Flattens a Google Ads lead into "field: value" pairs for the lead-intake job: standard questions under the
 * common names, custom questions under their question text, plus the lead, campaign and form IDs. The webhook
 * key (google_key) is left out so it is never stored with the lead.
 */
export function readGoogleAdsLead(body: Record<string, unknown>): Record<string, unknown> {
  const lead: Record<string, unknown> = {};
  const id = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined);
  for (const [key, value] of [
    ['lead_id', id(body.lead_id)],
    ['campaign_id', id(body.campaign_id)],
    ['form', id(body.form_id)],
    ['adgroup_id', id(body.adgroup_id)],
    ['creative_id', id(body.creative_id)],
    ['gcl_id', id(body.gcl_id)],
  ] as const) {
    if (value) lead[key] = value;
  }
  if (body.is_test === true) lead.is_test = true;
  const columns = Array.isArray(body.user_column_data) ? (body.user_column_data as GoogleColumn[]) : [];
  for (const c of columns) {
    if (!c || typeof c.string_value !== 'string' || !c.string_value.trim()) continue;
    const name = (c.column_id && COLUMN_NAMES[c.column_id]) ?? c.column_name?.trim() ?? c.column_id;
    if (name && !(name in lead)) lead[name] = c.string_value.trim();
  }
  return lead;
}
