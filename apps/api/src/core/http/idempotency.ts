import { CallHandler, ExecutionContext, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { createHash } from 'node:crypto';
import { Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { from, Observable, of, switchMap } from 'rxjs';
import { AuthenticatedRequest } from '../auth/principal';
import { DbService } from '../database/db.service';
import { ProblemException } from '../errors/problem';

// idempotency_keys (migration 0002)
const idempotencyKeys = pgTable('idempotency_keys', {
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  key: text('key').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  requestHash: text('request_hash').notNull(),
  statusCode: smallint('status_code'),
  responseBody: jsonb('response_body'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Idempotency-Key on POSTs (API guide §5): retrying with the same key returns the first result, so a double
 * click or network retry never creates a duplicate. The key is claimed inside the request's transaction, so a
 * failed request releases it, and a concurrent duplicate waits for the first one and then replays its answer.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly db: DbService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const key = req.header('idempotency-key');
    if (req.method !== 'POST' || !key || !req.principal) return next.handle();
    if (key.length > 100) throw new ProblemException(400, 'VALIDATION_FAILED', 'Invalid input', 'Idempotency-Key is too long (max 100).');

    const { tenantId, userId } = req.principal;
    const path = req.originalUrl.split('?')[0]!;
    const requestHash = createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');
    const res = context.switchToHttp().getResponse<Response>();
    const status = Reflect.getMetadata(HTTP_CODE_METADATA, context.getHandler()) ?? HttpStatus.CREATED;

    return from(this.claim(tenantId, userId, key, req.method, path, requestHash)).pipe(
      switchMap((stored) => {
        if (stored) {
          if (stored.requestHash !== requestHash || stored.path !== path) {
            throw new ProblemException(422, 'IDEMPOTENCY_KEY_REUSED', 'Key already used', 'This Idempotency-Key was used for a different request.');
          }
          res.status(stored.statusCode ?? status);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(stored.responseBody);
        }
        return next.handle().pipe(
          switchMap((body) =>
            from(
              this.db.current
                .update(idempotencyKeys)
                .set({ statusCode: status, responseBody: body ?? null })
                .where(and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
                .then(() => body),
            ),
          ),
        );
      }),
    );
  }

  /** Claims the key; returns the earlier request when the key was already used. */
  private async claim(tenantId: string, userId: string, key: string, method: string, path: string, requestHash: string) {
    const inserted = await this.db.current
      .insert(idempotencyKeys)
      .values({ tenantId, userId, key, method, path, requestHash })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });
    if (inserted.length) return undefined;
    const [stored] = await this.db.current
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
      .limit(1);
    if (stored && stored.statusCode === null) {
      throw new ProblemException(409, 'CONFLICT', 'Request in progress', 'The first request with this Idempotency-Key is still running.');
    }
    return stored;
  }
}

