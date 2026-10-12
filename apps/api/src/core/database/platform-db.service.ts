import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Database } from './db.service';

/**
 * crm_platform connection (security.sql: owner console and Stripe webhooks; BYPASSRLS). Used only by the billing
 * and platform modules for what tenant users may not change themselves: subscription status, plans, our tax
 * invoices and payments, the owner console. Business data (leads, messages) is never read through it.
 */
@Injectable()
export class PlatformDbService implements OnApplicationShutdown {
  private pool?: Pool;
  private database?: Database;
  private readonly tx = new AsyncLocalStorage<Database>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** The open platform transaction, or the pool. */
  get db(): Database {
    return this.tx.getStore() ?? this.base();
  }

  /** Runs `work` in one platform transaction. */
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.tx.getStore()) return work();
    this.base();
    const client = await this.pool!.connect();
    try {
      await client.query('BEGIN');
      const result = await this.tx.run(drizzle(client), work);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private base(): Database {
    if (!this.database) {
      if (!this.config.PLATFORM_DATABASE_URL) throw new Error('PLATFORM_DATABASE_URL is not set');
      this.pool = new Pool({ connectionString: this.config.PLATFORM_DATABASE_URL, max: 3, application_name: 'crm-platform' });
      this.database = drizzle(this.pool);
    }
    return this.database;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }
}
