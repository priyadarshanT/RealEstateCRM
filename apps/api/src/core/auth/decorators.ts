import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthenticatedRequest, Principal } from './principal';

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_PERMISSION = 'auth:permission';

/** No login needed (health check, public booking page, webhooks). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/** Permission key from the `permissions` table, matching `x-permission` in api/openapi.yaml. */
export const RequirePermission = (key: string): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_PERMISSION, key);

export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal | undefined => ctx.switchToHttp().getRequest<AuthenticatedRequest>().principal,
);
