import { Injectable } from '@nestjs/common';
import { AuditService } from '../../core/audit/audit.service';
import { DbService } from '../../core/database/db.service';
import { ProblemException, Problems } from '../../core/errors/problem';
import { toEtag, versionConflict } from '../../core/http/etag';
import { RequestContext } from '../../core/http/request-context';
import { OrganizationDirectory } from '../organization/directory.service';
import { OrganizationService } from '../organization/organization.service';
import { ClientPolicyDto, CurrencyDto, SetCurrenciesDto, SettingChangeDto, SettingDto } from './dto/settings.dto';
import { SettingsRepository } from './repositories/settings.repository';
import { isSettingKey, SETTING_DEFAULTS, SETTING_DEFINITIONS, SettingKey, SettingValue } from './setting-definitions';

/** Tenant settings and currencies (SRS §11.5). Other modules read settings through `get`. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly organization: OrganizationService,
    private readonly directory: OrganizationDirectory,
    private readonly audit: AuditService,
    private readonly db: DbService,
  ) {}

  /** Saved settings plus the Global Configuration defaults not saved yet (updatedAt empty). */
  async list(): Promise<SettingDto[]> {
    const rows = (await this.repo.list()).map((r) => SettingDto.from({ ...r, value: withDefaults(r.key, r.value) }));
    const saved = new Set(rows.map((r) => r.key));
    const defaults = Object.entries(SETTING_DEFAULTS)
      .filter(([key]) => !saved.has(key))
      .map(([key, value]) => ({ key, value: value as Record<string, unknown>, updatedAt: null }));
    return [...rows, ...defaults].sort((a, b) => a.key.localeCompare(b.key));
  }

  /** One setting (saved value or its default) with its version for If-Match. */
  async one(key: string): Promise<SettingDto> {
    if (!isSettingKey(key)) throw Problems.notFound();
    const row = await this.repo.find(key);
    if (row) return SettingDto.from({ ...row, value: withDefaults(key, row.value) });
    const value = SETTING_DEFAULTS[key];
    if (!value) throw Problems.notFound();
    return { key, value: value as Record<string, unknown>, updatedAt: null };
  }

  /** A validated setting value for the current tenant. */
  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const row = await this.repo.find(key);
    if (!row) {
      const fallback = SETTING_DEFAULTS[key];
      if (fallback) return fallback as SettingValue<K>;
      throw new Error(`Setting ${key} is missing for this tenant (create_tenant_defaults sets it)`);
    }
    return SETTING_DEFINITIONS[key].parse(withDefaults(key, row.value)) as SettingValue<K>;
  }

  /** A setting that has no default row (e.g. finance.numbering until the Admin sets it). */
  async find<K extends SettingKey>(key: K): Promise<SettingValue<K> | undefined> {
    const row = await this.repo.find(key);
    return row ? (SETTING_DEFINITIONS[key].parse(withDefaults(key, row.value)) as SettingValue<K>) : undefined;
  }

  /**
   * Saves a setting. With If-Match, a change saved by someone else in the meantime is refused (409) instead of
   * silently overwritten; the version of a setting never saved is "default".
   */
  async update(key: string, value: Record<string, unknown>, expectedVersion?: string): Promise<SettingDto> {
    if (!isSettingKey(key)) throw new ProblemException(422, 'UNKNOWN_SETTING', 'Unknown setting', `There is no setting called "${key}".`);
    const parsed = SETTING_DEFINITIONS[key].safeParse(value);
    if (!parsed.success) {
      throw Problems.validation(parsed.error.issues.map((i) => ({ field: ['value', ...i.path].join('.'), message: i.message })));
    }
    const before = await this.repo.find(key);
    if (expectedVersion !== undefined && expectedVersion !== (before ? before.updatedAt.toISOString() : 'default')) throw versionConflict();
    const row = await this.repo.upsert(this.tenantId(), key, parsed.data as Record<string, unknown>, RequestContext.get().userId);
    await this.audit.record('setting_change', 'tenant_settings', null, { [key]: [before?.value ?? SETTING_DEFAULTS[key] ?? null, row.value] });
    return SettingDto.from(row);
  }

  /** Change history of one setting: who, when, before and after (newest first, last 100 setting changes). */
  async history(key: string): Promise<SettingChangeDto[]> {
    if (!isSettingKey(key)) throw Problems.notFound();
    const page = await this.audit.list({ entityType: 'tenant_settings', limit: 100 });
    const users = await this.directory.users(page.data.flatMap((e) => (e.userId ? [e.userId] : [])));
    return page.data
      .filter((e) => e.changes && key in e.changes)
      .map((e) => {
        const [before, after] = (e.changes![key] as [unknown, unknown]) ?? [null, null];
        return { at: e.createdAt, userId: e.userId, userName: e.userId ? (users.get(e.userId)?.fullName ?? null) : null, before, after };
      });
  }

  /** The switches the screens follow, readable by every signed-in user (values only, no history). */
  async clientPolicy(): Promise<ClientPolicyDto> {
    const [security, leads, general] = await Promise.all([this.get('security.policy'), this.get('leads.features'), this.get('general.preferences')]);
    return {
      allowCopyPaste: security.allow_copy_paste,
      exportLeads: leads.export_leads,
      sourceUpdate: leads.source_update,
      pastDateSelection: leads.past_date_selection,
      mandatoryLocation: leads.mandatory_location,
      unassignedCommunication: leads.unassigned_communication,
      dualOwnership: leads.dual_ownership,
      defaultCountry: general.default_country,
      defaultCurrency: general.default_currency,
    };
  }

  /** ETag of a setting (see update). */
  static etag(s: SettingDto): string {
    return toEtag(s.updatedAt ?? 'default');
  }

  async listCurrencies(): Promise<CurrencyDto[]> {
    return this.repo.enabledCurrencies();
  }

  /** Replaces the enabled currencies (the base currency is always enabled) and records any new rates. */
  async setCurrencies(body: SetCurrenciesDto): Promise<string[]> {
    const tenantId = this.tenantId();
    const base = (await this.organization.getProfile(tenantId)).baseCurrency;
    const codes = [...new Set(body.currencies.map((c) => c.code))];
    if (!codes.includes(base)) {
      throw Problems.validation([{ field: 'currencies', message: `the base currency ${base} must stay enabled` }]);
    }
    const known = await this.repo.knownCurrencyCodes(codes);
    const unknown = codes.filter((c) => !known.has(c));
    if (unknown.length) throw Problems.validation(unknown.map((c) => ({ field: 'currencies', message: `unknown currency ${c}` })));

    const before = (await this.repo.enabledCurrencies()).map((c) => c.code);
    await this.repo.replaceEnabledCurrencies(tenantId, codes);
    const today = new Date().toISOString().slice(0, 10);
    const rates: Record<string, [null, string]> = {};
    for (const c of body.currencies) {
      if (!c.rateToBase || c.code === base) continue;
      const date = c.effectiveDate ?? today;
      await this.repo.upsertRate(tenantId, c.code, date, c.rateToBase);
      rates[`rate.${c.code}.${date}`] = [null, c.rateToBase];
    }
    await this.audit.record('setting_change', 'tenant_currencies', null, { currencies: [before, [...codes].sort()], ...rates });
    return [...codes].sort();
  }

  private tenantId(): string {
    return this.db.currentTenantId!;
  }
}

/** A saved value completed with switches added later (their defaults), so older rows keep working. */
function withDefaults(key: string, value: Record<string, unknown>): Record<string, unknown> {
  const defaults = isSettingKey(key) ? (SETTING_DEFAULTS[key] as Record<string, unknown> | undefined) : undefined;
  return defaults ? { ...defaults, ...value } : value;
}
