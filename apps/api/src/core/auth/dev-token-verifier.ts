import { jwtVerify, SignJWT } from 'jose';
import { authTimeOf, TokenVerifier, VerifiedToken } from './principal';

const ISSUER = 'crm-dev';
const TENANT_CLAIM = 'custom:tenant_id';

/** Local development login: HS256 tokens signed with DEV_AUTH_SECRET. Refused in production by config. */
export class DevTokenVerifier implements TokenVerifier {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async verify(token: string): Promise<VerifiedToken> {
    const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, algorithms: ['HS256'] });
    const tenantId = payload[TENANT_CLAIM];
    if (!payload.sub || typeof tenantId !== 'string') throw new Error('token is missing sub or tenant');
    return {
      subject: payload.sub,
      tenantId,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      authTime: authTimeOf(payload),
    };
  }
}

export function signDevToken(secret: string, claims: { sub: string; tenantId: string; email?: string }, ttl = '1h'): Promise<string> {
  return new SignJWT({ [TENANT_CLAIM]: claims.tenantId, ...(claims.email ? { email: claims.email } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(new TextEncoder().encode(secret));
}
