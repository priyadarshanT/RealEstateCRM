import { Request } from 'express';

export type DataScope = 'own' | 'team' | 'division' | 'company';

/** Claims taken from a verified login token. */
export interface VerifiedToken {
  subject: string;
  tenantId: string;
  email?: string;
}

/** The signed-in user, resolved once per request and used by every check after login. */
export interface Principal {
  userId: string;
  tenantId: string;
  email: string;
  roleKey: string;
  dataScope: DataScope;
  permissions: ReadonlySet<string>;
  tenantStatus: 'active' | 'suspended' | 'closed';
}

export type AuthenticatedRequest = Request & { principal?: Principal; requestId?: string };

/** Adapter per login provider (Cognito in AWS, a local signer in development). */
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

/**
 * Looks up the user behind a token. Implemented by the organization module, which owns users and roles.
 * Called inside a transaction for the token's tenant; returns null when the user does not exist or is inactive.
 */
export interface PrincipalResolver {
  resolve(token: VerifiedToken): Promise<Principal | null>;
}
export const PRINCIPAL_RESOLVER = Symbol('PRINCIPAL_RESOLVER');

/** Subscription state of a tenant. Implemented by the billing module, which owns subscriptions. */
export interface SubscriptionStatusProvider {
  isReadOnly(tenantId: string): Promise<boolean>;
}
export const SUBSCRIPTION_STATUS = Symbol('SUBSCRIPTION_STATUS');
