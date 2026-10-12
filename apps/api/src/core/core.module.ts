import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { TenantTransactionInterceptor } from './database/tenant-transaction.interceptor';
import { ProblemFilter } from './errors/problem.filter';
import { createValidationPipe } from './errors/validation.pipe';
import { HealthController } from './health/health.controller';
import { IdempotencyInterceptor } from './http/idempotency';
import { rateLimits } from './http/rate-limit';
import { EventsModule } from './events/events.module';
import { FilesModule } from './files/files.module';
import { QueueModule } from './queue/queue.module';
import { SecretsModule } from './secrets/secret-store';
import { MailModule } from './mail/mailer';
import { PlatformDbModule } from './database/platform-db.module';
import { RequestContextInterceptor } from './http/request-context';

/** Shared infrastructure used by every business module. */
@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule, AuditModule, EventsModule, QueueModule, FilesModule, SecretsModule, MailModule, PlatformDbModule, ThrottlerModule.forRoot(rateLimits)],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    // Interceptors run in this order: request context, tenant transaction, idempotency (needs the transaction).
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class CoreModule {}
