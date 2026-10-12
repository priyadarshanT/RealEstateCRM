import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, PoolClient } from 'pg';

export const PG_POOL = Symbol('PG_POOL');

export type Database = NodePgDatabase;

interface TenantTransaction {
  tenantId: string;
  db: Database;
  client: PoolClient;
}

/**
 * Tenant-scoped database access. Every query runs inside a transaction that starts with
 * SET LOCAL app.tenant_id, so PostgreSQL row-level security only returns that tenant's rows.
 * Repositories call `db.current` and never open connections themselves.
 */
@Injectable()
export class DbService implements OnApplicationShutdown {
  private readonly storage = new AsyncLocalStorage<TenantTransaction>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The open tenant transaction for this request. */
  get current(): Database {
    const tx = this.storage.getStore();
    if (!tx) throw new Error('No tenant transaction is open; wrap the call in DbService.withTenant');
    return tx.db;
  }

  get currentTenantId(): string | undefined {
    return this.storage.getStore()?.tenantId;
  }

  /** The raw connection of the open transaction (e.g. so a queued job commits together with the change). */
  get currentClient(): PoolClient | undefined {
    return this.storage.getStore()?.client;
  }

  /** Runs `work` in one transaction for `tenantId`. Nested calls for the same tenant reuse it. */
  async withTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    const open = this.storage.getStore();
    if (open) {
      if (open.tenantId !== tenantId) throw new Error('A transaction for another tenant is already open');
      return work();
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const result = await this.storage.run({ tenantId, db: drizzle(client), client }, work);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Runs `work` in a savepoint of the open transaction: if it fails, only its own changes are undone and the
   * error is returned instead of thrown (bulk actions report each item separately).
   */
  async savepoint<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    const client = this.currentClient;
    if (!client) throw new Error('No tenant transaction is open');
    const name = `sp_${Math.random().toString(36).slice(2, 10)}`;
    await client.query(`SAVEPOINT ${name}`);
    try {
      const value = await work();
      await client.query(`RELEASE SAVEPOINT ${name}`);
      return { ok: true, value };
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      return { ok: false, error };
    }
  }

  /** Connectivity check that touches no tenant data. */
  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
