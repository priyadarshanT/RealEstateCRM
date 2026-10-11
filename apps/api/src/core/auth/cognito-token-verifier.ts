import { createRemoteJWKSet, JWTVerifyGetKey, jwtVerify } from 'jose';
import { TokenVerifier, VerifiedToken } from './principal';

const TENANT_CLAIM = 'custom:tenant_id';

/**
 * Amazon Cognito access tokens (OIDC). The tenant ID and email are added to the access token
 * by the user pool's pre-token-generation trigger.
 */
export class CognitoTokenVerifier implements TokenVerifier {
  private readonly keys: JWTVerifyGetKey;

  constructor(
    private readonly issuer: string,
    private readonly clientId: string,
  ) {
    this.keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  }

  async verify(token: string): Promise<VerifiedToken> {
    const { payload } = await jwtVerify(token, this.keys, { issuer: this.issuer, algorithms: ['RS256'] });
    if (payload.token_use !== 'access' || payload.client_id !== this.clientId) throw new Error('not an access token for this app');
    const tenantId = payload[TENANT_CLAIM];
    if (!payload.sub || typeof tenantId !== 'string') throw new Error('token is missing sub or tenant');
    return { subject: payload.sub, tenantId, email: typeof payload.email === 'string' ? payload.email : undefined };
  }
}
