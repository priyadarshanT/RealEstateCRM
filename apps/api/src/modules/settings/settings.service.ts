import { Injectable } from '@nestjs/common';
import { AuditService } from '../../core/audit/audit.service';
import { DbService } from '../../core/database/db.service';
import { ProblemException, Problems } from '../../core/errors/problem';
import { RequestContext } from '../../core/http/request-context';
import { OrganizationService } from '../organization/organization.service';
import { CurrencyDto, SetCurrenciesDto, SettingDto } from './dto/settings.dto';
import { SettingsRepository } from './repositories/settings.repository';
import { isSettingKey, SETTING_DEFINITIONS, SettingKey, SettingValue } from './setting-definitions';

/** Tenant settings and currencies (SRS §11.5). Other modules read settings through `get`. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly organization: OrganizationService,
    private readonly audit: AuditService,
    private readonly db: DbService,
  ) {}

  async list(): Promise<SettingDto[]> {
    return (await this.repo.list()).map(SettingDto.from);
  }

  /** A validated setting value for the current tenant. */
  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const row = await this.repo.find(key);
    if (!row) throw new Error(`Setting ${key} is missing for this tenant (create_tenant_defaults sets it)`);
    return SETTING_DEFINITIONS[key].parse(row.value) as SettingValue<K>;
  }

  /** A setting that has no default row (e.g. finance.numbering until the Admin sets it). */
  async find<K extends SettingKey>(key: K): Promise<SettingValue<K> | undefined> {
    const row = await this.repo.find(key);
    return row ? (SETTING_DEFINITIONS[key].parse(row.value) as SettingValue<K>) : undefined;
  }

  async update(key: string, value: Record<string, unknown>): Promise<SettingDto> {
    if (!isSettingKey(key)) throw new ProblemException(422, 'UNKNOWN_SETTING', 'Unknown setting', `There is no setting called "${key}".`);
    const parsed = SETTING_DEFINITIONS[key].safeParse(value);
    if (!parsed.success) {
      throw Problems.validation(parsed.error.issues.map((i) => ({ field: ['value', ...i.path].join('.'), message: i.message })));
    }
    const before = await this.repo.find(key);
    const row = await this.repo.upsert(this.tenantId(), key, parsed.data as Record<string, unknown>, RequestContext.get().userId);
    await this.audit.record('setting_change', 'tenant_settings', null, { [key]: [before?.value ?? null, row.value] });
    return SettingDto.from(row);
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
