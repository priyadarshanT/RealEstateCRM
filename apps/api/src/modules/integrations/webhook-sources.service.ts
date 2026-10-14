import { Inject, Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { and, eq, inArray } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../../core/audit/audit.service';
import { Principal } from '../../core/auth/principal';
import { APP_CONFIG, AppConfig } from '../../core/config/app-config';
import { DbService } from '../../core/database/db.service';
import { Problems } from '../../core/errors/problem';
import { IsUuid } from '../../core/http/validators';
import { SECRET_STORE, SecretPaths, SecretStore } from '../../core/secrets/secret-store';
import { LeadConfigService } from '../settings/lead-config.service';
import { FieldMapping, mappingErrors } from './inbox/field-mapping';
import { IntegrationRow, integrations } from './integrations.schema';

// ---------------------------------------------------------------- DTOs (components.schemas.WebhookSource)
export class WebhookSourceDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) integrationId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ readOnly: true, example: 'https://crm.example.ae/webhooks/inbound/whk_3f9c…' }) inboundUrl!: string;
  @ApiPropertyOptional({ readOnly: true, description: 'Shown once; used to sign requests (HMAC-SHA256)' }) secret?: string;
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) fieldMapping!: Record<string, string>;
}

export class WebhookSourceInputDto {
  @IsOptional() integrationId?: unknown;
  @IsOptional() inboundUrl?: unknown;
  @IsOptional() secret?: unknown;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @ApiProperty({ format: 'uuid' }) @IsUuid() sourceId!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) @IsObject() fieldMapping!: Record<string, string>;
}

export class WebhookMappingDto {
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) @IsObject() fieldMapping!: Record<string, string>;
}

/**
 * General webhook (SRS §11.2): a secure link any system can send leads to (website, Google Sheets, Excel via
 * Power Automate, Make.com). Each request is signed with the source's secret (X-Signature, HMAC-SHA256); the
 * Admin maps the incoming fields to CRM fields once. The secret is shown once and kept in the secret store.
 */
@Injectable()
export class WebhookSourcesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly sources: LeadConfigService,
    private readonly paths: SecretPaths,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(p: Principal, body: WebhookSourceInputDto): Promise<WebhookSourceDto> {
    await this.validate(body.sourceId, body.fieldMapping);
    const token = `whk_${randomBytes(18).toString('base64url')}`;
    const inboundUrl = this.inboundUrl(token);
    const [row] = await this.db.current
      .insert(integrations)
      .values({
        tenantId: p.tenantId,
        provider: 'webhook',
        scope: 'tenant',
        accountLabel: body.name.trim(),
        externalAccountId: token,
        status: 'connected',
        settings: { sourceId: body.sourceId, fieldMapping: clean(body.fieldMapping), inboundUrl },
        connectedBy: p.userId,
        connectedAt: new Date(),
      })
      .returning();
    const secret = await this.newSecret(row!);
    await this.audit.record('create', 'integrations', row!.id, { provider: [null, 'webhook'], accountLabel: [null, row!.accountLabel] });
    return { ...this.toDto(row!), secret };
  }

  async updateMapping(id: string, fieldMapping: Record<string, string>): Promise<WebhookSourceDto> {
    const row = await this.get(id);
    await this.validate(row.settings.sourceId as string, fieldMapping);
    const settings = { ...row.settings, fieldMapping: clean(fieldMapping) };
    const [updated] = await this.db.current.update(integrations).set({ settings, updatedAt: new Date() }).where(eq(integrations.id, id)).returning();
    await this.audit.record('setting_change', 'integrations', id, { fieldMapping: [row.settings.fieldMapping, settings.fieldMapping] });
    return this.toDto(updated!);
  }

  /** A new secret replaces the old one at once; senders must use the new one. */
  async rotateSecret(id: string): Promise<WebhookSourceDto> {
    const row = await this.get(id);
    const secret = await this.newSecret(row);
    await this.audit.record('setting_change', 'integrations', id, { secret: ['rotated', 'rotated'] });
    return { ...this.toDto(row), secret };
  }

  private async get(id: string): Promise<IntegrationRow> {
    const [row] = await this.db.current
      .select()
      .from(integrations)
      .where(and(eq(integrations.id, id), inArray(integrations.provider, ['webhook', 'website'])))
      .limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }

  private async validate(sourceId: string, fieldMapping: Record<string, unknown>): Promise<void> {
    const errors = mappingErrors(fieldMapping);
    const source = await this.sources.getSource(sourceId).catch(() => undefined);
    if (!source) errors.push({ field: 'sourceId', message: 'lead source not found' });
    if (errors.length) throw Problems.validation(errors);
  }

  private async newSecret(row: IntegrationRow): Promise<string> {
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const secretRef = this.paths.integration(row.tenantId, row.id);
    await this.secrets.put(secretRef, JSON.stringify({ secret }));
    if (row.secretRef !== secretRef) await this.db.current.update(integrations).set({ secretRef }).where(eq(integrations.id, row.id));
    return secret;
  }

  private inboundUrl(token: string): string {
    return `${this.config.PUBLIC_API_URL}/api/v1/webhooks/inbound/${token}`;
  }

  private toDto(row: IntegrationRow): WebhookSourceDto {
    return {
      integrationId: row.id,
      name: row.accountLabel,
      inboundUrl: (row.settings.inboundUrl as string) ?? this.inboundUrl(row.externalAccountId ?? ''),
      sourceId: row.settings.sourceId as string,
      fieldMapping: (row.settings.fieldMapping as Record<string, string>) ?? {},
    };
  }
}

function clean(mapping: Record<string, string>): FieldMapping {
  return Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v.trim()]));
}
