import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Database } from './db.service';

/**
 * crm_worker connection (BYPASSRLS, security.sql) for the worker's cross-tenant scans only, e.g. "leads whose
 * response time has passed, in every tenant". The work on each row then runs in DbService.withTenant as usual.
 */
@Injectable()
export class WorkerDbService implements OnApplicationShutdown {
  private pool?: Pool;
  private database?: Database;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get db(): Database {
    if (!this.database) {
      if (!this.config.WORKER_DATABASE_URL) throw new Error('WORKER_DATABASE_URL is not set');
      this.pool = new Pool({ connectionString: this.config.WORKER_DATABASE_URL, max: 3, application_name: 'crm-worker-scan' });
      this.database = drizzle(this.pool);
    }
    return this.database;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }
}
