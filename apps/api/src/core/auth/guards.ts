import { CanActivate, ExecutionContext, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DbService } from '../database/db.service';
import { Problems } from '../errors/problem';
import { RequestContext } from '../http/request-context';
import { ALLOW_WHEN_READ_ONLY, IS_PUBLIC, REQUIRED_PERMISSION } from './decorators';
import {
  AuthenticatedRequest,
  PRINCIPAL_RESOLVER,
  PrincipalResolver,
  SUBSCRIPTION_STATUS,
  SubscriptionStatusProvider,
  TOKEN_VERIFIER,
  TokenVerifier,
} from './principal';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isPublic(reflector: Reflector, context: ExecutionContext): boolean {
  return reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]) ?? false;
}

/** Steps 1 and 2: validate the login token, then load the user inside their tenant. */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    @Inject(PRINCIPAL_RESOLVER) private readonly resolver: PrincipalResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublic(this.reflector, context)) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (request.header('authorization') ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw Problems.unauthorized('A bearer token is required.');

    let claims;
    try {
      claims = await this.verifier.verify(token);
    } catch (err) {
      this.logger.debug(`token rejected: ${(err as Error).message}`);
      throw Problems.unauthorized('The token is invalid or expired.');
    }

    const info = { requestId: request.requestId, ipAddress: request.ip, userAgent: request.header('user-agent')?.slice(0, 500) };
    const principal = await RequestContext.run(info, () => this.db.withTenant(claims.tenantId, () => this.resolver.resolve(claims)));
    if (!principal) throw Problems.unauthorized('No active user for this login.');
    if (principal.tenantStatus === 'suspended') throw Problems.tenantSuspended();
    if (principal.tenantStatus === 'closed') throw Problems.forbidden('This company account is closed.');
    request.principal = principal;
    return true;
  }
}

/** Step 3: the user's role must include the endpoint's permission. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string | string[]>(REQUIRED_PERMISSION, [context.getHandler(), context.getClass()]);
    if (!required) return true;
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    const keys = Array.isArray(required) ? required : [required];
    if (!keys.some((k) => principal?.permissions.has(k))) throw Problems.forbidden();
    return true;
  }
}

/** A read-only (unpaid) company may read and export but not change anything: 402 on writes. */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
    @Optional() @Inject(SUBSCRIPTION_STATUS) private readonly subscriptions?: SubscriptionStatusProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.principal;
    if (!principal || !this.subscriptions || READ_METHODS.has(request.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_READ_ONLY, [context.getHandler(), context.getClass()])) return true;
    const readOnly = await this.db.withTenant(principal.tenantId, () => this.subscriptions!.isReadOnly(principal.tenantId));
    if (readOnly) throw Problems.readOnly();
    return true;
  }
}
