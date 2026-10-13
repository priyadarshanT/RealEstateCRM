import { SignJWT } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { authMode, PLATFORM_SESSION_COOKIE } from '@/core/config';

// Local development login for the owner console, standing in for its own Cognito pool with two-factor.
// Signs the token the API's PlatformAuthGuard accepts in AUTH_MODE=dev (issuer crm-dev-platform).

const TTL_SECONDS = 8 * 60 * 60;

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.DEV_AUTH_SECRET;
  if (authMode() !== 'dev' || !secret) {
    return NextResponse.json({ title: 'Dev login is turned off', code: 'DEV_LOGIN_DISABLED', status: 404 }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ title: 'Email is required', code: 'VALIDATION_FAILED', status: 422 }, { status: 422 });

  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(`dev-platform|${email}`)
    .setIssuer('crm-dev-platform')
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(secret));

  const res = NextResponse.json({ ok: true });
  res.cookies.set(PLATFORM_SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: TTL_SECONDS });
  return res;
}

export async function DELETE(): Promise<Response> {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(PLATFORM_SESSION_COOKIE);
  return res;
}
