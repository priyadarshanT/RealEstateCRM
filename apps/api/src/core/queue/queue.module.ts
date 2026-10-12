import { Global, Module } from '@nestjs/common';
import { WorkerDbService } from '../database/worker-db.service';
import { HousekeepingJobs } from './housekeeping';
import { QueueService } from './queue.service';

@Global()
@Module({ providers: [QueueService, WorkerDbService, HousekeepingJobs], exports: [QueueService, WorkerDbService] })
export class QueueModule {}
