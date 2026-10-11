import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DbService, PG_POOL } from './db.service';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Pool({ connectionString: config.DATABASE_URL, max: config.DATABASE_POOL_MAX, application_name: 'crm-api' }),
    },
    DbService,
  ],
  exports: [DbService],
})
export class DatabaseModule {}
