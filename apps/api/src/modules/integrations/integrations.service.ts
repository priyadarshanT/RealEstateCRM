import { Inject, Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { APP_CONFIG, AppConfig } from '../../core/config/app-config';
import { DbService } from '../../core/database/db.service';
import { ProblemException, Problems } from '../../core/errors/problem';
import { decodeCursor, encodeCursor, Page, PageInfo } from '../../core/http/pagination';
import { QueueService } from '../../core/queue/queue.service';
import { SECRET_STORE, SecretPaths, SecretStore } from '../../core/secrets/secret-store';
import { IntegrationRow, integrations, Provider, PROVIDERS, syncRuns, webhookEvents, WebhookEventRow } from './integrations.schema';
import { META_API, MetaApi } from './meta/meta-api';

// ---------------------------------------------------------------- DTOs (components.schemas.Integration, ...)
export class IntegrationDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ enum: PROVIDERS }) provider!: Provider;
  @ApiProperty({ enum: ['tenant', 'user'] }) scope!: 'tenant' | 'user';
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) userId!: string | null;
  @ApiProperty() accountLabel!: string;
  @ApiProperty({ enum: ['pending', 'connected', 'error', 'disconnected'], readOnly: true }) status!: IntegrationRow['status'];
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, readOnly: true }) lastSuccessAt!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, readOnly: true }) lastErrorAt!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, readOnly: true }) lastError!: string | null;
  @ApiPropertyOptional({ readOnly: true }) recordsReceived30d!: number;
  @ApiPropertyOptional({ readOnly: true }) failures30d!: number;
  @ApiPropertyOptional({ type: Object }) settings!: Record<string, unknown>;
}

export class IntegrationList {
  @ApiProperty({ type: [IntegrationDto] }) data!: IntegrationDto[];
}

export class IntegrationConnectDto {
  @ApiProperty() @IsIn(PROVIDERS) provider!: Provider;
  @ApiPropertyOptional({ enum: ['tenant', 'user'] }) @IsOptional() @IsIn(['tenant', 'user']) scope?: 'tenant' | 'user';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) accountLabel?: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() settings?: Record<string, unknown>;
}

export class ConnectStartDto {
  @ApiProperty({ format: 'uuid' }) integrationId!: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Open this URL to finish OAuth; empty for key-based providers' }) authorizeUrl!: string | null;
}

export class IntegrationUpdateDto {
  @IsOptional() id?: unknown;
  @IsOptional() provider?: unknown;
  @IsOptional() scope?: unknown;
  @IsOptional() userId?: unknown;
  @IsOptional() status?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) accountLabel?: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() settings?: Record<string, unknown>;
}

export class WebhookEventDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() provider!: string;
  @ApiPropertyOptional() externalEventId!: string;
  @ApiProperty({ enum: ['received', 'processed', 'failed', 'ignored'] }) status!: WebhookEventRow['status'];
  @ApiProperty() attempts!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) lastError!: string | null;
  @ApiProperty({ format: 'date-time' }) receivedAt!: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) processedAt!: string | null;

  static from(e: WebhookEventRow): WebhookEventDto {
    return {
      id: e.id,
      provider: e.provider,
      externalEventId: e.externalEventId,
      status: e.status,
      attempts: e.attempts,
      lastError: e.lastError,
      receivedAt: e.receivedAt.toISOString(),
      processedAt: e.processedAt?.toISOString() ?? null,
    };
  }
}

export class WebhookEventPage {
  @ApiProperty({ type: [WebhookEventDto] }) data!: WebhookEventDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class SyncRunDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() jobType!: string;
  @ApiProperty({ enum: ['running', 'success', 'partial', 'failed'] }) status!: string;
  @ApiPropertyOptional() recordsReceived!: number;
  @ApiPropertyOptional() recordsCreated!: number;
  @ApiPropertyOptional() recordsFailed!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) errorDetail!: string | null;
  @ApiProperty({ format: 'date-time' }) startedAt!: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) finishedAt!: string | null;
}

export class SyncRunPage {
  @ApiProperty({ type: [SyncRunDto] }) data!: SyncRunDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

/** Providers connected in Phase 1 (SRS phases): Meta lead ads. The others arrive with Phase 2. */
const PHASE_1_PROVIDERS: Provider[] = ['meta'];
const OAUTH_STATE_MINUTES = 10;

/**
 * Connections to outside accounts (SRS §11): connect (OAuth), status, last success and errors, records received,
 * test, retry, disconnect. Tokens are stored in SSM; the database keeps only the parameter path.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly paths: SecretPaths,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(META_API) private readonly meta: MetaApi,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(p: Principal): Promise<IntegrationDto[]> {
    const rows = await this.db.current
      .select()
      .from(integrations)
      .where(or(eq(integrations.scope, 'tenant'), eq(integrations.userId, p.userId)))
      .orderBy(integrations.provider, integrations.accountLabel);
    return this.toDtos(rows);
  }

  async get(id: string): Promise<IntegrationRow> {
    const [row] = await this.db.current.select().from(integrations).where(eq(integrations.id, id)).limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }

  async getDto(id: string): Promise<IntegrationDto> {
    return (await this.toDtos([await this.get(id)]))[0]!;
  }

  /** Starts a connection. OAuth providers return the URL to open; the callback finishes it. */
  async connect(p: Principal, body: IntegrationConnectDto): Promise<ConnectStartDto> {
    if (!PHASE_1_PROVIDERS.includes(body.provider)) {
      throw Problems.validation([{ field: 'provider', message: `${body.provider} is connected from Phase 2 (SRS phases)` }]);
    }
    if (!this.config.META_APP_ID || !this.config.META_APP_SECRET) {
      throw new ProblemException(422, 'INTEGRATION_NOT_CONFIGURED', 'Meta is not set up', 'The Meta app ID and secret are missing on the server.');
    }
    const nonce = randomBytes(16).toString('base64url');
    const [row] = await this.db.current
      .insert(integrations)
      .values({
        tenantId: p.tenantId,
        provider: body.provider,
        scope: 'tenant',
        accountLabel: body.accountLabel ?? 'Meta lead ads',
        settings: { ...(body.settings ?? {}), oauthNonce: nonce },
      })
      .returning();
    const state = this.signState({ t: p.tenantId, i: row!.id, u: p.userId, n: nonce, e: Date.now() + OAUTH_STATE_MINUTES * 60_000 });
    await this.audit.record('create', 'integrations', row!.id, { provider: [null, body.provider] });
    return { integrationId: row!.id, authorizeUrl: this.meta.authorizeUrl(state, this.redirectUri(body.provider)) };
  }

  /**
   * OAuth callback (Meta): exchanges the code, picks the page (settings.pageId or the first page), keeps the page
   * token in SSM, subscribes the page to lead events. Returns where to send the browser.
   */
  async finishOAuth(provider: string, code: string | undefined, state: string): Promise<string> {
    const back = (q: Record<string, string>) => `${this.config.WEB_APP_URL}/settings/integrations?${new URLSearchParams(q)}`;
    const claims = this.verifyState(state);
    if (!claims || provider !== 'meta') return back({ error: 'invalid_state' });
    return this.db.withTenant(claims.t, async () => {
      const row = await this.get(claims.i).catch(() => undefined);
      if (!row || row.settings.oauthNonce !== claims.n) return back({ error: 'invalid_state' });
      const { oauthNonce: _used, ...settings } = row.settings;
      try {
        if (!code) throw new Error('Access was not granted');
        const userToken = await this.meta.exchangeCode(code, this.redirectUri('meta'));
        const pages = await this.meta.pages(userToken);
        const page = pages.find((pg) => pg.id === settings.pageId) ?? pages[0];
        if (!page) throw new Error('No Facebook page found for this account');
        const secretRef = this.paths.integration(row.tenantId, row.id);
        await this.secrets.put(secretRef, JSON.stringify({ pageAccessToken: page.accessToken }));
        await this.meta.subscribePage(page.id, page.accessToken);
        await this.db.current
          .update(integrations)
          .set({
            status: 'connected',
            externalAccountId: page.id,
            accountLabel: page.name,
            secretRef,
            settings: { ...settings, pageId: page.id },
            connectedBy: claims.u,
            connectedAt: new Date(),
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(integrations.id, row.id));
        await this.audit.record('update', 'integrations', row.id, { status: [row.status, 'connected'] }, claims.u);
        return back({ connected: row.id });
      } catch (err) {
        await this.db.current
          .update(integrations)
          .set({ status: 'error', settings, lastError: (err as Error).message.slice(0, 500), lastErrorAt: new Date(), updatedAt: new Date() })
          .where(eq(integrations.id, row.id));
        return back({ error: 'connection_failed', integration: row.id });
      }
    });
  }

  async update(id: string, body: IntegrationUpdateDto): Promise<IntegrationDto> {
    const before = await this.get(id);
    const settings = body.settings ? { ...before.settings, ...body.settings, ...(before.settings.pageId ? { pageId: before.settings.pageId } : {}) } : before.settings;
    await this.db.current
      .update(integrations)
      .set({ ...(body.accountLabel !== undefined ? { accountLabel: body.accountLabel } : {}), settings, updatedAt: new Date() })
      .where(eq(integrations.id, id));
    await this.audit.record('setting_change', 'integrations', id, { accountLabel: [before.accountLabel, body.accountLabel ?? before.accountLabel], settings: [before.settings, settings] });
    return this.getDto(id);
  }

  /** Disconnect: no new data is accepted; the token is removed from SSM; history stays. */
  async disconnect(id: string): Promise<void> {
    const row = await this.get(id);
    if (row.secretRef) await this.secrets.delete(row.secretRef);
    await this.db.current.update(integrations).set({ status: 'disconnected', secretRef: null, updatedAt: new Date() }).where(eq(integrations.id, id));
    await this.audit.record('update', 'integrations', id, { status: [row.status, 'disconnected'] });
  }

  async test(id: string): Promise<{ ok: boolean; detail: string }> {
    const row = await this.get(id);
    if (row.status !== 'connected' || !row.externalAccountId) return { ok: false, detail: `Not connected (status: ${row.status})` };
    const token = await this.pageToken(row);
    if (!token) return { ok: false, detail: 'The access token is missing; connect again' };
    const result = await this.meta.check(row.externalAccountId, token);
    await this.db.current
      .update(integrations)
      .set(result.ok ? { lastSuccessAt: new Date() } : { lastError: result.detail.slice(0, 500), lastErrorAt: new Date() })
      .where(eq(integrations.id, id));
    return result;
  }

  async pageToken(row: IntegrationRow): Promise<string | undefined> {
    if (!row.secretRef) return undefined;
    const raw = await this.secrets.get(row.secretRef);
    return raw ? (JSON.parse(raw) as { pageAccessToken?: string }).pageAccessToken : undefined;
  }

  // ---------------------------------------------------------------- incoming events and runs
  async events(integrationId: string, limit: number, cursor?: string, status?: string): Promise<Page<WebhookEventDto>> {
    await this.get(integrationId);
    const offset = cursor ? Number(decodeCursor(cursor, 1)[0]) : 0;
    const rows = await this.db.current
      .select()
      .from(webhookEvents)
      .where(and(eq(webhookEvents.integrationId, integrationId), status ? eq(webhookEvents.status, status as WebhookEventRow['status']) : undefined))
      .orderBy(desc(webhookEvents.receivedAt), desc(webhookEvents.id))
      .limit(limit + 1)
      .offset(offset);
    const hasMore = rows.length > limit;
    return { data: rows.slice(0, limit).map(WebhookEventDto.from), page: { nextCursor: hasMore ? encodeCursor([offset + limit]) : null, hasMore } };
  }

  async syncRuns(integrationId: string, limit: number, cursor?: string): Promise<Page<SyncRunDto>> {
    await this.get(integrationId);
    const offset = cursor ? Number(decodeCursor(cursor, 1)[0]) : 0;
    const rows = await this.db.current
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.integrationId, integrationId))
      .orderBy(desc(syncRuns.startedAt))
      .limit(limit + 1)
      .offset(offset);
    const hasMore = rows.length > limit;
    return {
      data: rows.slice(0, limit).map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null })),
      page: { nextCursor: hasMore ? encodeCursor([offset + limit]) : null, hasMore },
    };
  }

  /** Retry: failed incoming events go back to the queue (SRS §11.4). */
  async retryFailed(integrationId: string): Promise<number> {
    await this.get(integrationId);
    const failed = await this.db.current
      .update(webhookEvents)
      .set({ status: 'received', lastError: null })
      .where(and(eq(webhookEvents.integrationId, integrationId), eq(webhookEvents.status, 'failed')))
      .returning();
    for (const e of failed) await this.queue.send('lead-intake', { tenantId: e.tenantId!, webhookEventId: e.id });
    return failed.length;
  }

  async retryOne(eventId: string): Promise<WebhookEventDto> {
    const [event] = await this.db.current.select().from(webhookEvents).where(eq(webhookEvents.id, eventId)).limit(1);
    if (!event) throw Problems.notFound();
    if (event.status === 'processed') throw new ProblemException(409, 'CONFLICT', 'Already processed', 'This event was already processed.');
    const [row] = await this.db.current.update(webhookEvents).set({ status: 'received', lastError: null }).where(eq(webhookEvents.id, eventId)).returning();
    await this.queue.send('lead-intake', { tenantId: row!.tenantId!, webhookEventId: row!.id });
    return WebhookEventDto.from(row!);
  }

  private async toDtos(rows: IntegrationRow[]): Promise<IntegrationDto[]> {
    if (!rows.length) return [];
    const since = new Date(Date.now() - 30 * 86_400_000);
    const stats = await this.db.current
      .select({
        integrationId: webhookEvents.integrationId,
        received: sql<number>`count(*)::int`,
        failed: sql<number>`count(*) FILTER (WHERE ${webhookEvents.status} = 'failed')::int`,
      })
      .from(webhookEvents)
      .where(and(inArray(webhookEvents.integrationId, rows.map((r) => r.id)), gte(webhookEvents.receivedAt, since)))
      .groupBy(webhookEvents.integrationId);
    const statOf = new Map(stats.map((s) => [s.integrationId, s]));
    return rows.map((r) => {
      const { oauthNonce: _hidden, ...settings } = r.settings;
      return {
        id: r.id,
        provider: r.provider,
        scope: r.scope,
        userId: r.userId,
        accountLabel: r.accountLabel,
        status: r.status,
        lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
        lastErrorAt: r.lastErrorAt?.toISOString() ?? null,
        lastError: r.lastError,
        recordsReceived30d: statOf.get(r.id)?.received ?? 0,
        failures30d: statOf.get(r.id)?.failed ?? 0,
        settings,
      };
    });
  }

  private redirectUri(provider: string): string {
    return `${this.config.PUBLIC_API_URL}/api/v1/oauth/${provider}/callback`;
  }

  private signState(claims: { t: string; i: string; u: string; n: string; e: number }): string {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${body}.${createHmac('sha256', this.stateKey()).update(body).digest('base64url')}`;
  }

  private verifyState(state: string): { t: string; i: string; u: string; n: string; e: number } | undefined {
    const [body, mac] = state.split('.');
    if (!body || !mac) return undefined;
    const expected = createHmac('sha256', this.stateKey()).update(body).digest('base64url');
    if (expected.length !== mac.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return undefined;
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return claims.e > Date.now() ? claims : undefined;
  }

  private stateKey(): string {
    const key = this.config.OAUTH_STATE_SECRET ?? this.config.DEV_AUTH_SECRET;
    if (!key) throw new Error('OAUTH_STATE_SECRET is not set');
    return key;
  }
}
