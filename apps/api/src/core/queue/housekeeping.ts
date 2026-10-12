import { Injectable, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { WorkerDbService } from '../database/worker-db.service';
import { QueueService } from './queue.service';

/** Hourly clean-up across tenants: Idempotency-Keys are kept 24 hours (API guide §5). */
@Injectable()
export class HousekeepingJobs implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly workerDb: WorkerDbService,
  ) {}

  onModuleInit(): void {
    this.queue.register('housekeeping', () => this.run(), { cron: '0 * * * *' });
  }

  async run(): Promise<void> {
    await this.workerDb.db.execute(sql`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`);
  }
}
