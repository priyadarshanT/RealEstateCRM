import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { TenantTransactionInterceptor } from './database/tenant-transaction.interceptor';
import { ProblemFilter } from './errors/problem.filter';
import { createValidationPipe } from './errors/validation.pipe';
import { HealthController } from './health/health.controller';

/** Shared infrastructure used by every business module. */
@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
  ],
})
export class CoreModule {}
