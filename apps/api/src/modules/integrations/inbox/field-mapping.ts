// Field mapping for incoming leads (SRS §11.2): the Admin maps incoming field names to CRM fields once; every
// new row or form then becomes a lead. Portals and lead emails use the same mapping with common defaults.

/** CRM fields an incoming field can be mapped to (keys of WebhookSource.fieldMapping). */
export const CRM_FIELDS = [
  'fullName',
  'firstName',
  'lastName',
  'phonePrimary',
  'phoneAlternate',
  'email',
  'preferredLanguage',
  'countryCode',
  'city',
  'budgetMin',
  'budgetMax',
  'budgetCurrency',
  'project',
  'note',
  'formName',
  'externalId',
  'externalCampaignId',
] as const;
export type CrmField = (typeof CRM_FIELDS)[number];
export type FieldMapping = Partial<Record<CrmField, string>>;

/** Names tried when a CRM field is not mapped (case and spaces / dashes / underscores ignored). */
const DEFAULT_NAMES: Partial<Record<CrmField, string[]>> = {
  fullName: ['full_name', 'name', 'client_name', 'customer_name', 'contact_name', 'lead_name'],
  firstName: ['first_name', 'firstname', 'given_name'],
  lastName: ['last_name', 'lastname', 'surname', 'family_name'],
  phonePrimary: ['phone', 'phone_number', 'mobile', 'mobile_number', 'telephone', 'contact_number', 'whatsapp'],
  phoneAlternate: ['alternate_phone', 'phone2', 'second_phone'],
  email: ['email', 'email_address', 'e_mail'],
  preferredLanguage: ['language', 'preferred_language'],
  city: ['city', 'city_name', 'town'],
  budgetMin: ['budget_min', 'min_budget', 'budget'],
  budgetMax: ['budget_max', 'max_budget'],
  budgetCurrency: ['currency', 'budget_currency'],
  project: ['project', 'project_name', 'interested_in', 'property', 'listing_title'],
  note: ['message', 'comments', 'comment', 'enquiry', 'inquiry', 'notes', 'remarks'],
  formName: ['form', 'form_name', 'listing_reference', 'property_reference', 'reference'],
  externalId: ['lead_id', 'leadid', 'enquiry_id', 'inquiry_id', 'submission_id', 'id'],
  externalCampaignId: ['campaign_id', 'utm_campaign'],
};

export interface MappedLead {
  fullName: string | null;
  phone: string | null;
  phoneAlternate: string | null;
  email: string | null;
  preferredLanguage: string | null;
  countryCode: string | null;
  city: string | null;
  budgetMin: string | null;
  budgetMax: string | null;
  budgetCurrency: string | null;
  note: string | null;
  formName: string | null;
  externalId: string | null;
  externalCampaignId: string | null;
  /** Every incoming field as text (kept on the enquiry as the form answers). */
  answers: Record<string, string>;
}

/** Unknown CRM fields and empty names are refused; the general webhook must map a phone or an email. */
export function mappingErrors(mapping: Record<string, unknown>, requireContact = true): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];
  for (const [key, value] of Object.entries(mapping)) {
    if (!(CRM_FIELDS as readonly string[]).includes(key)) errors.push({ field: `fieldMapping.${key}`, message: `unknown CRM field; use one of ${CRM_FIELDS.join(', ')}` });
    else if (typeof value !== 'string' || !value.trim() || value.length > 200) errors.push({ field: `fieldMapping.${key}`, message: 'the incoming field name is required (200 characters at most)' });
  }
  if (requireContact && !errors.length && !mapping.phonePrimary && !mapping.email) errors.push({ field: 'fieldMapping', message: 'map at least the phone or the email' });
  return errors;
}

/** Applies the mapping (dotted paths such as "contact.phone" reach nested values), then the default names. */
export function mapFields(payload: Record<string, unknown>, mapping: FieldMapping = {}): MappedLead {
  const answers = flatten(payload);
  const byKey = new Map(Object.entries(answers).map(([k, v]) => [normalize(k), v]));
  // Nested fields also answer to their own name ("contact.phone" → "phone") unless a top-level field has it.
  for (const [k, v] of Object.entries(answers)) {
    const leaf = normalize(k.split('.').pop()!);
    if (!byKey.has(leaf)) byKey.set(leaf, v);
  }
  const pick = (field: CrmField): string | null => {
    const mapped = mapping[field];
    if (mapped) {
      const value = answers[mapped] ?? byKey.get(normalize(mapped));
      if (value) return value;
    }
    for (const name of DEFAULT_NAMES[field] ?? []) {
      const value = byKey.get(normalize(name));
      if (value) return value;
    }
    return null;
  };
  const first = pick('firstName');
  const last = pick('lastName');
  const project = pick('project');
  const note = pick('note');
  return {
    fullName: pick('fullName') ?? ([first, last].filter(Boolean).join(' ') || null),
    phone: pick('phonePrimary'),
    phoneAlternate: pick('phoneAlternate'),
    email: pick('email'),
    preferredLanguage: pick('preferredLanguage'),
    countryCode: pick('countryCode'),
    city: pick('city'),
    budgetMin: numeric(pick('budgetMin')),
    budgetMax: numeric(pick('budgetMax')),
    budgetCurrency: pick('budgetCurrency')?.toUpperCase().slice(0, 3) ?? null,
    // Projects are linked by the Projects module (Phase 3); until then the project asked about is kept in the note.
    note: [project ? `Project: ${project}` : null, note].filter(Boolean).join('\n') || null,
    formName: pick('formName'),
    externalId: pick('externalId'),
    externalCampaignId: pick('externalCampaignId'),
    answers,
  };
}

function flatten(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== 'object' || v === null)) {
      if (prefix && value.length) out[prefix] = value.filter((v) => v !== null && v !== '').join(', ');
    } else value.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  const text = String(value).trim();
  if (prefix && text) out[prefix] = text.slice(0, 2000);
  return out;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[\s_\-.]/g, '');
}

function numeric(value: string | null): string | null {
  if (!value) return null;
  const n = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? String(n) : null;
}
