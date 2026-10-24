import { Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { DbService } from '../../../core/database/db.service';
import { WorkerDbService } from '../../../core/database/worker-db.service';
import { QueueService, TenantJob } from '../../../core/queue/queue.service';
import { IntegrationRow, integrations, Provider, webhookEvents, WebhookEventRow } from '../integrations.schema';

/** components.schemas.WebhookAck: answered at once; the work happens in the worker. */
export class WebhookAck {
  @ApiProperty() received!: boolean;
}

/** Queues that process stored webhook events (pre-created in migration 0003). */
export type InboxQueue = 'lead-intake' | 'message-status' | 'calendar-sync';

export interface InboxJob extends TenantJob {
  webhookEventId: string;
}

export interface StoreInput {
  provider: string;
  externalEventId: string;
  payload: Record<string, unknown>;
  /** The connected account the event belongs to; without one the event is kept as ignored. */
  integration?: Pick<IntegrationRow, 'id' | 'tenantId'>;
  signatureValid?: boolean;
  queue: InboxQueue;
  ignoredReason?: string;
}

const MAX_ATTEMPTS = 5;

/** A failure that retrying cannot fix (e.g. a lead without phone or email): the event fails at once. */
export class PermanentEventError extends Error {}

/**
 * Every incoming webhook is stored before processing, so nothing is lost and duplicates are ignored
 * (webhook_events, unique per provider and event ID); the worker then processes it. Failures retry 5 times with
 * a growing delay, then stay failed on the Integrations screen with Retry (SRS §11.4).
 * Webhooks arrive without a tenant, so finding the account reads across tenants (crm_worker).
 */
@Injectable()
export class WebhookInbox {
  constructor(
    private readonly workerDb: WorkerDbService,
    private readonly db: DbService,
    private readonly queue: QueueService,
  ) {}

  /** A connected account by its ID at the provider (page, phone number, inbound token, portal account). */
  async accountById(providers: Provider[], externalAccountId: string): Promise<IntegrationRow | undefined> {
    const [row] = await this.workerDb.db
      .select()
      .from(integrations)
      .where(and(inArray(integrations.provider, providers), eq(integrations.externalAccountId, externalAccountId), eq(integrations.status, 'connected')))
      .limit(1);
    return row;
  }

  /** A connected account by one of its settings (e.g. the portal secret's hash, the inbound email address). */
  async accountBySetting(providers: Provider[], key: string, value: string): Promise<IntegrationRow | undefined> {
    const [row] = await this.workerDb.db
      .select()
      .from(integrations)
      .where(and(inArray(integrations.provider, providers), sql`${integrations.settings} ->> ${key} = ${value}`, eq(integrations.status, 'connected')))
      .limit(1);
    return row;
  }

  /** Every connected account of these providers, in all tenants (scheduled jobs such as the calendar check). */
  connectedAccounts(providers: Provider[]): Promise<IntegrationRow[]> {
    return this.workerDb.db
      .select()
      .from(integrations)
      .where(and(inArray(integrations.provider, providers), eq(integrations.status, 'connected')));
  }

  /** Marks a connection as failing, outside the caller's transaction so it is kept when that one rolls back. */
  async markError(integrationId: string, message: string): Promise<void> {
    await this.workerDb.db
      .update(integrations)
      .set({ status: 'error', lastError: message.slice(0, 500), lastErrorAt: new Date(), updatedAt: new Date() })
      .where(eq(integrations.id, integrationId));
  }

  /** Saves the event and queues it. Returns false when the same event was already received. */
  async store(input: StoreInput): Promise<boolean> {
    const [event] = await this.workerDb.db
      .insert(webhookEvents)
      .values({
        tenantId: input.integration?.tenantId ?? null,
        integrationId: input.integration?.id ?? null,
        provider: input.provider,
        externalEventId: input.externalEventId.slice(0, 500),
        signatureValid: input.signatureValid ?? true,
        payload: input.payload,
        status: input.integration ? 'received' : 'ignored',
        lastError: input.integration ? null : (input.ignoredReason ?? 'No connected account for this event'),
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (!event) return false;
    if (input.integration) await this.queue.send<InboxJob>(input.queue, { tenantId: input.integration.tenantId, webhookEventId: event.id });
    return true;
  }

  /**
   * Sends an event that was received before but not imported (failed or ignored) back to processing, e.g. a lead
   * the Meta check found missing. Returns whether it was queued.
   */
  async requeue(provider: string, externalEventId: string, integration: Pick<IntegrationRow, 'id' | 'tenantId'>, queue: InboxQueue): Promise<boolean> {
    // An ignored event has no tenant yet (unknown account at the time), so this reads across tenants.
    const [row] = await this.workerDb.db
      .update(webhookEvents)
      .set({ status: 'received', attempts: 0, lastError: null, tenantId: integration.tenantId, integrationId: integration.id })
      .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.externalEventId, externalEventId), inArray(webhookEvents.status, ['failed', 'ignored'])))
      .returning({ id: webhookEvents.id });
    if (!row) return false;
    await this.queue.send<InboxJob>(queue, { tenantId: integration.tenantId, webhookEventId: row.id });
    return true;
  }

  /**
   * Worker step (inside the tenant's transaction): runs the work for one stored event and records the outcome on
   * the event and its integration. A failure is retried later with a growing delay, up to 5 attempts.
   */
  async process(queue: InboxQueue, eventId: string, work: (event: WebhookEventRow, integration: IntegrationRow) => Promise<void>): Promise<void> {
    const [event] = await this.db.current.select().from(webhookEvents).where(eq(webhookEvents.id, eventId)).limit(1);
    if (!event || event.status !== 'received' || !event.integrationId) return;
    const [integration] = await this.db.current.select().from(integrations).where(eq(integrations.id, event.integrationId)).limit(1);
    const outcome = await this.db.savepoint(async () => {
      if (!integration || integration.status !== 'connected') throw new Error(`Integration is ${integration?.status ?? 'missing'}`);
      await work(event, integration);
    });

    if (outcome.ok) {
      await this.db.current.update(webhookEvents).set({ status: 'processed', attempts: sql`${webhookEvents.attempts} + 1`, processedAt: new Date(), lastError: null }).where(eq(webhookEvents.id, eventId));
      await this.db.current.update(integrations).set({ lastSuccessAt: new Date() }).where(eq(integrations.id, event.integrationId));
      return;
    }
    const message = (outcome.error as Error).message.slice(0, 1000);
    const attempts = outcome.error instanceof PermanentEventError ? MAX_ATTEMPTS : event.attempts + 1;
    await this.db.current.update(webhookEvents).set({ status: attempts >= MAX_ATTEMPTS ? 'failed' : 'received', attempts, lastError: message }).where(eq(webhookEvents.id, eventId));
    await this.db.current.update(integrations).set({ lastError: message, lastErrorAt: new Date() }).where(eq(integrations.id, event.integrationId));
    if (attempts < MAX_ATTEMPTS) {
      await this.queue.send<InboxJob>(queue, { tenantId: event.tenantId!, webhookEventId: eventId }, { startAfter: 30 * 2 ** (attempts - 1) });
    }
  }
}

/** The exact bytes received (signatures are checked over them). Text bodies (e.g. SNS) are not parsed by Nest. */
export async function rawBodyOf(req: Request & { rawBody?: Buffer }): Promise<Buffer> {
  if (req.rawBody) return req.rawBody;
  if (req.readableEnded) return Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** HMAC-SHA256 of the body in hex, optionally prefixed "sha256=", compared in constant time. */
export function validHmac(raw: Buffer, header: string | undefined, secret: string | undefined): boolean {
  if (!header || !secret) return false;
  const given = Buffer.from(header.trim().replace(/^sha256=/i, '').toLowerCase());
  const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
