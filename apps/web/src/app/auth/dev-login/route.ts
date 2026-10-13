import { SignJWT } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { authMode, SESSION_COOKIE } from '@/core/config';

// Local development login, standing in for Cognito. Signs the same HS256 token as
// `pnpm --filter @crm/api dev:token` (issuer crm-dev, custom:tenant_id claim). Refused unless AUTH_MODE=dev.

const TTL_SECONDS = 8 * 60 * 60;

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.DEV_AUTH_SECRET;
  if (authMode() !== 'dev' || !secret) {
    return NextResponse.json({ title: 'Dev login is turned off', code: 'DEV_LOGIN_DISABLED', status: 404 }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { tenantId?: string; email?: string } | null;
  const tenantId = body?.tenantId?.trim();
  const email = body?.email?.trim().toLowerCase();
  if (!tenantId || !email) {
    return NextResponse.json({ title: 'Company ID and email are required', code: 'VALIDATION_FAILED', status: 422 }, { status: 422 });
  }

  const token = await new SignJWT({ 'custom:tenant_id': tenantId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(`dev|${email}`)
    .setIssuer('crm-dev')
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(secret));

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: TTL_SECONDS });
  return res;
}
