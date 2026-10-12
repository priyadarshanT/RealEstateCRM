import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { DbService } from '../../../core/database/db.service';
import { currencies, exchangeRates, SettingRow, tenantCurrencies, tenantSettings } from '../settings.schema';

export interface EnabledCurrency {
  code: string;
  name: string;
  rateToBase: string | null;
}

@Injectable()
export class SettingsRepository {
  constructor(private readonly db: DbService) {}

  async list(): Promise<SettingRow[]> {
    return this.db.current.select().from(tenantSettings).orderBy(asc(tenantSettings.key));
  }

  async find(key: string): Promise<SettingRow | undefined> {
    const [row] = await this.db.current.select().from(tenantSettings).where(eq(tenantSettings.key, key)).limit(1);
    return row;
  }

  async upsert(tenantId: string, key: string, value: Record<string, unknown>, userId: string | undefined): Promise<SettingRow> {
    const [row] = await this.db.current
      .insert(tenantSettings)
      .values({ tenantId, key, value, updatedBy: userId ?? null })
      .onConflictDoUpdate({
        target: [tenantSettings.tenantId, tenantSettings.key],
        set: { value, updatedBy: userId ?? null, updatedAt: sql`now()` },
      })
      .returning();
    return row!;
  }

  /** Enabled currencies with the latest rate effective on or before today. */
  async enabledCurrencies(): Promise<EnabledCurrency[]> {
    const enabled = await this.db.current
      .select({ code: tenantCurrencies.currency, name: currencies.name })
      .from(tenantCurrencies)
      .innerJoin(currencies, eq(currencies.code, tenantCurrencies.currency))
      .orderBy(asc(tenantCurrencies.currency));
    const rates = await this.db.current
      .selectDistinctOn([exchangeRates.currency], { currency: exchangeRates.currency, rate: exchangeRates.rateToBase })
      .from(exchangeRates)
      .where(lte(exchangeRates.effectiveDate, sql`current_date`))
      .orderBy(exchangeRates.currency, desc(exchangeRates.effectiveDate));
    const rateOf = new Map(rates.map((r) => [r.currency, r.rate]));
    return enabled.map((c) => ({ code: c.code, name: c.name, rateToBase: rateOf.get(c.code) ?? null }));
  }

  async knownCurrencyCodes(codes: string[]): Promise<Set<string>> {
    if (!codes.length) return new Set();
    const rows = await this.db.current.select({ code: currencies.code }).from(currencies).where(inArray(currencies.code, codes));
    return new Set(rows.map((r) => r.code));
  }

  async replaceEnabledCurrencies(tenantId: string, codes: string[]): Promise<void> {
    await this.db.current.delete(tenantCurrencies);
    if (codes.length) await this.db.current.insert(tenantCurrencies).values(codes.map((currency) => ({ tenantId, currency })));
  }

  async upsertRate(tenantId: string, currency: string, effectiveDate: string, rateToBase: string): Promise<void> {
    await this.db.current
      .insert(exchangeRates)
      .values({ tenantId, currency, effectiveDate, rateToBase })
      .onConflictDoUpdate({
        target: [exchangeRates.tenantId, exchangeRates.currency, exchangeRates.effectiveDate],
        set: { rateToBase },
      });
  }

  async hasRate(currency: string, effectiveDate: string, rateToBase: string): Promise<boolean> {
    const rows = await this.db.current
      .select({ c: exchangeRates.currency })
      .from(exchangeRates)
      .where(and(eq(exchangeRates.currency, currency), eq(exchangeRates.effectiveDate, effectiveDate), eq(exchangeRates.rateToBase, rateToBase)))
      .limit(1);
    return rows.length > 0;
  }
}
