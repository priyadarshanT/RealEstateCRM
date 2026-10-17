import { z } from 'zod';

// Tenant setting keys the application knows and how their values are validated (tenant_settings.value is
// "validated by the application", db/schema.sql). Defaults come from create_tenant_defaults in db/seed.sql,
// or from SETTING_DEFAULTS below for the Global Configuration settings (stakeholder update 2026-10-17).

const percent = z.number().int().min(0).max(100);

export const SETTING_DEFINITIONS = {
  /** SRS §3.4–3.6: minutes an agent has to act on a new lead before it moves on (10 by default). */
  'leads.response_time': z
    .object({
      minutes: z.number().int().min(1).max(1440),
      next_agent_scope: z.literal('team'),
      fallback: z.literal('admin'),
    })
    .strict(),
  /** SRS §2.24: lead score weights (budget, project match, source quality, engagement), adding up to 100. */
  'leads.scoring': z
    .object({ budget_fit: percent, project_match: percent, source_quality: percent, engagement: percent })
    .strict()
    .refine((w) => w.budget_fit + w.project_match + w.source_quality + w.engagement === 100, {
      message: 'weights must add up to 100',
    }),
  /** SRS §11.5, §7.2: invoice numbering per document type, e.g. INV-2026-0042 (prefix, year, digits). */
  'finance.numbering': z
    .object(
      Object.fromEntries(
        (['sales_invoice', 'purchase_invoice', 'purchase_order'] as const).map((t) => [
          t,
          z
            .object({
              prefix: z.string().min(1).max(12).regex(/^[A-Za-z0-9/_-]+$/),
              include_year: z.boolean(),
              padding: z.number().int().min(1).max(10),
            })
            .strict(),
        ]),
      ) as Record<'sales_invoice' | 'purchase_invoice' | 'purchase_order', z.ZodObject<{ prefix: z.ZodString; include_year: z.ZodBoolean; padding: z.ZodNumber }, 'strict'>>,
    )
    .strict(),
  /** Global Configuration › General: call alerts, default country and currency, watermark. */
  'general.preferences': z
    .object({
      call_notifications: z.boolean(),
      call_detection: z.boolean(),
      default_country: z.string().regex(/^[A-Z]{2}$/, 'an ISO country code such as AE'),
      default_currency: z.string().regex(/^[A-Z]{3}$/, 'an ISO currency code such as AED'),
      watermark: z
        .object({
          enabled: z.boolean(),
          kind: z.enum(['text', 'logo']),
          text: z.string().max(60),
          opacity: z.number().int().min(5).max(80),
          position: z.enum(['center', 'tiled', 'bottom_right', 'top_left']),
          apply_to: z.array(z.enum(['brochures', 'floor_plans', 'images', 'documents'])).max(4),
        })
        .strict()
        .refine((w) => !w.enabled || w.kind === 'logo' || w.text.trim().length > 0, { message: 'enter the watermark text', path: ['text'] }),
    })
    .strict(),
  /** Global Configuration › Security (Admin only, every change audited). */
  'security.policy': z.object({ require_2fa: z.boolean(), allow_copy_paste: z.boolean(), disable_screenshots: z.boolean() }).strict(),
  /** Global Configuration › Leads: feature switches, enforced by the server. */
  'leads.features': z
    .object({
      export_leads: z.boolean(),
      source_update: z.boolean(),
      dual_ownership: z.boolean(),
      secondary_owner_notification: z.boolean(),
      past_date_selection: z.boolean(),
      hide_contact_info: z.object({ enabled: z.boolean(), role_keys: z.array(z.string().regex(/^[a-z_]+$/)).max(50) }).strict(),
      mandatory_location: z.boolean(),
      unassigned_communication: z.boolean(),
    })
    .strict()
    .refine((v) => !v.secondary_owner_notification || v.dual_ownership, {
      message: 'turn on Dual Lead Ownership first',
      path: ['secondary_owner_notification'],
    })
    .refine((v) => !v.hide_contact_info.enabled || v.hide_contact_info.role_keys.length > 0, {
      message: 'choose at least one role',
      path: ['hide_contact_info', 'role_keys'],
    }),
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFINITIONS)[K]>;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_DEFINITIONS, key);
}

/**
 * Values used until the Admin saves a setting. Exports and communication with unassigned leads start off
 * (Global Configuration §10); copy and paste stays allowed.
 */
export const SETTING_DEFAULTS: { [K in SettingKey]?: SettingValue<K> } = {
  'general.preferences': {
    call_notifications: false,
    call_detection: false,
    default_country: 'AE',
    default_currency: 'AED',
    watermark: { enabled: false, kind: 'text', text: '', opacity: 20, position: 'bottom_right', apply_to: ['brochures', 'floor_plans', 'images'] },
  },
  'security.policy': { require_2fa: false, allow_copy_paste: true, disable_screenshots: false },
  'leads.features': {
    export_leads: false,
    source_update: false,
    dual_ownership: false,
    secondary_owner_notification: false,
    past_date_selection: false,
    hide_contact_info: { enabled: false, role_keys: [] },
    mandatory_location: false,
    unassigned_communication: false,
  },
};
