import { z } from 'zod';

// Tenant setting keys the application knows and how their values are validated (tenant_settings.value is
// "validated by the application", db/schema.sql). Defaults come from create_tenant_defaults in db/seed.sql.

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
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFINITIONS)[K]>;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_DEFINITIONS, key);
}
