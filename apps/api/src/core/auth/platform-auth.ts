import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createRemoteJWKSet, jwtVerify, JWTVerifyGetKey, SignJWT } from 'jose';
import { Request } from 'express';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { PlatformDbService } from '../database/platform-db.service';
import { Problems } from '../errors/problem';

// platform_admins (db/schema.sql, Platform): people who run the CRM business. Not part of any tenant.
export const platformAdmins = pgTable('platform_admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  authSubject: text('auth_subject'),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  role: text('role').$type<PlatformRole>().notNull(),
  status: text('status').$type<'active' | 'inactive'>().notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});

export type PlatformRole = 'owner' | 'support' | 'billing';

export interface PlatformAdmin {
  id: string;
  email: string;
  fullName: string;
  role: PlatformRole;
}

export type PlatformRequest = Request & { platformAdmin?: PlatformAdmin };

const DEV_ISSUER = 'crm-dev-platform';
const PLATFORM_ROLES = 'platform:roles';

/** Roles allowed on an owner-console endpoint (API: "platform: owner, support"). No decorator = any platform role. */
export const PlatformRoles = (...roles: PlatformRole[]): MethodDecorator & ClassDecorator => SetMetadata(PLATFORM_ROLES, roles);

export const CurrentPlatformAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PlatformAdmin => ctx.switchToHttp().getRequest<PlatformRequest>().platformAdmin!,
);

/** Local development: an owner-console token signed with DEV_AUTH_SECRET (stands in for the platform Cognito pool). */
export function signDevPlatformToken(secret: string, claims: { sub: string; email: string }): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(DEV_ISSUER)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

/**
 * Owner console login (API guide §10a): its own Cognito user pool with two-factor, never a tenant token.
 * The first login links the provider subject to the platform admin with that email.
 */
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  private keys?: JWTVerifyGetKey;

  constructor(
    private readonly reflector: Reflector,
    private readonly platformDb: PlatformDbService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PlatformRequest>();
    const [scheme, token] = (req.header('authorization') ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw Problems.unauthorized('A bearer token is required.');
    const claims = await this.verify(token).catch(() => undefined);
    if (!claims) throw Problems.unauthorized('The token is invalid or expired.');

    const db = this.platformDb.db;
    let [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.authSubject, claims.sub)).limit(1);
    if (!admin && claims.email) {
      [admin] = await db
        .update(platformAdmins)
        .set({ authSubject: claims.sub })
        .where(and(sql`${platformAdmins.email} = ${claims.email}::citext`, isNull(platformAdmins.authSubject)))
        .returning();
    }
    if (!admin || admin.status !== 'active') throw Problems.unauthorized('No active owner-console account for this login.');
    await db.update(platformAdmins).set({ lastLoginAt: new Date() }).where(eq(platformAdmins.id, admin.id));

    const allowed = this.reflector.getAllAndOverride<PlatformRole[]>(PLATFORM_ROLES, [context.getHandler(), context.getClass()]);
    if (allowed && !allowed.includes(admin.role)) throw Problems.forbidden();
    req.platformAdmin = { id: admin.id, email: admin.email, fullName: admin.fullName, role: admin.role };
    return true;
  }

  private async verify(token: string): Promise<{ sub: string; email?: string }> {
    if (this.config.AUTH_MODE === 'dev') {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(this.config.DEV_AUTH_SECRET!), { issuer: DEV_ISSUER, algorithms: ['HS256'] });
      return { sub: payload.sub!, email: typeof payload.email === 'string' ? payload.email : undefined };
    }
    if (!this.config.PLATFORM_COGNITO_ISSUER || !this.config.PLATFORM_COGNITO_CLIENT_ID) throw new Error('platform login not configured');
    this.keys ??= createRemoteJWKSet(new URL(`${this.config.PLATFORM_COGNITO_ISSUER}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, this.keys, { issuer: this.config.PLATFORM_COGNITO_ISSUER, algorithms: ['RS256'] });
    if (payload.token_use !== 'access' || payload.client_id !== this.config.PLATFORM_COGNITO_CLIENT_ID) throw new Error('not a platform access token');
    return { sub: payload.sub!, email: typeof payload.email === 'string' ? payload.email : undefined };
  }
}
