import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { apiUrl, authMode, PLATFORM_SESSION_COOKIE, SESSION_COOKIE } from '@/core/config';
import { accessToken, type PoolKey } from '@/core/oidc';

// Forwards /api/v1/* to the NestJS API and adds the login token from the httpOnly session cookie,
// so the token is never readable by browser scripts and the API needs no CORS. With Cognito an expired
// token is renewed from the refresh token, and a call the API refuses (401) is retried once with a fresh one.

const FORWARD_REQUEST_HEADERS = ['content-type', 'accept', 'if-match', 'idempotency-key', 'cf-turnstile-token'];
const FORWARD_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'etag', 'location', 'x-request-id', 'retry-after'];

async function forward(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await params;
  const target = `${apiUrl()}/api/v1/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const h of FORWARD_REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Owner-console calls (/platform/*) use the owner-console login; everything else the CRM login.
  const key: PoolKey = path[0] === 'platform' ? 'platform' : 'users';
  const cognito = authMode() === 'cognito';
  const token = cognito ? await accessToken(key) : (await cookies()).get(key === 'platform' ? PLATFORM_SESSION_COOKIE : SESSION_COOKIE)?.value;
  if (token) headers.set('authorization', `Bearer ${token}`);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? await req.arrayBuffer() : undefined;
  const send = () => fetch(target, { method: req.method, headers, body, redirect: 'manual', cache: 'no-store' });
  let upstream = await send();
  if (upstream.status === 401 && cognito && token) {
    const renewed = await accessToken(key, true);
    if (renewed) {
      headers.set('authorization', `Bearer ${renewed}`);
      upstream = await send();
    }
  }

  const out = new Headers();
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers: out });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
