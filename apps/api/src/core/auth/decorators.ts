import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthenticatedRequest, Principal } from './principal';

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_PERMISSION = 'auth:permission';
export const ALLOW_WHEN_READ_ONLY = 'auth:allow-read-only';

/** No login needed (health check, public booking page, webhooks). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/** Permission key from the `permissions` table, matching `x-permission` in api/openapi.yaml. */
export const RequirePermission = (key: string): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_PERMISSION, key);

export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal | undefined => ctx.switchToHttp().getRequest<AuthenticatedRequest>().principal,
);

/** Allowed while the company is read-only (unpaid after the grace period): paying, the card, data export (SRS §12). */
export const AllowWhenReadOnly = (): MethodDecorator & ClassDecorator => SetMetadata(ALLOW_WHEN_READ_ONLY, true);
