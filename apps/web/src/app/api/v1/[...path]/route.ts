import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { apiUrl, PLATFORM_SESSION_COOKIE, SESSION_COOKIE } from '@/core/config';

// Forwards /api/v1/* to the NestJS API and adds the login token from the httpOnly session cookie,
// so the token is never readable by browser scripts and the API needs no CORS.

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
  const cookie = path[0] === 'platform' ? PLATFORM_SESSION_COOKIE : SESSION_COOKIE;
  const token = (await cookies()).get(cookie)?.value;
  if (token) headers.set('authorization', `Bearer ${token}`);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    redirect: 'manual',
    cache: 'no-store',
  });

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
