import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../../../core/database/db.service';
import { TenantRow, tenants } from '../organization.schema';

/** Columns the app may change (security.sql grants UPDATE on these only). */
export type TenantPatch = Partial<
  Pick<
    TenantRow,
    | 'name'
    | 'legalName'
    | 'tradeLicenseNo'
    | 'reraOrn'
    | 'reraBrn'
    | 'trn'
    | 'email'
    | 'phone'
    | 'address'
    | 'website'
    | 'logoFileId'
    | 'tradeLicenseFileId'
    | 'timezone'
    | 'baseCurrency'
  >
>;

@Injectable()
export class TenantRepository {
  constructor(private readonly db: DbService) {}

  async find(tenantId: string): Promise<TenantRow | undefined> {
    const [row] = await this.db.current.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return row;
  }

  async update(tenantId: string, patch: TenantPatch): Promise<TenantRow | undefined> {
    const [row] = await this.db.current.update(tenants).set(patch).where(eq(tenants.id, tenantId)).returning();
    return row;
  }
}
