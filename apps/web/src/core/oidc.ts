import { base64url, compactDecrypt, CompactEncrypt } from 'jose';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { apiUrl, PLATFORM_REFRESH_COOKIE, PLATFORM_SESSION_COOKIE, REFRESH_COOKIE, SESSION_COOKIE } from './config';

// Amazon Cognito sign-in (AUTH_MODE=cognito), run by the web server: authorization code with PKCE and the client
// secret (infra/terraform/modules/crm/cognito.tf). The access token goes in an httpOnly cookie that the API proxy
// sends as the bearer token; the refresh token is kept encrypted with SESSION_SECRET and renews the access token
// when it runs out. Server-side only (route handlers and pages), never in the browser.

export type PoolKey = 'users' | 'platform';

interface Pool {
  domain: string;
  clientId: string;
  clientSecret: string;
  /** Where Cognito returns after sign-in (must match the app client's callback URL). */
  callbackPath: string;
  /** Sign-in page of this pool (Cognito's logout URL returns here). */
  signedOutPath: string;
  defaultNext: string;
  accessCookie: string;
  refreshCookie: string;
  flowCookie: string;
  /** API call that confirms the login belongs to an active user. */
  mePath: string;
}

export interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

const FLOW_SECONDS = 10 * 60;
const REFRESH_SECONDS = 30 * 86_400; // refresh_token_validity in Terraform
const SCOPES = 'openid email profile';

const basicAuth = (p: { clientId: string; clientSecret: string }) => `Basic ${btoa(`${encodeURIComponent(p.clientId)}:${encodeURIComponent(p.clientSecret)}`)}`;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set when AUTH_MODE=cognito`);
  return v;
}

export function pool(key: PoolKey): Pool {
  const p = key === 'platform' ? 'PLATFORM_' : '';
  return {
    domain: required(`${p}COGNITO_DOMAIN`).replace(/\/+$/, ''),
    clientId: required(`${p}COGNITO_CLIENT_ID`),
    clientSecret: required(`${p}COGNITO_CLIENT_SECRET`),
    callbackPath: key === 'platform' ? '/auth/platform-callback' : '/auth/callback',
    signedOutPath: key === 'platform' ? '/console/login' : '/login',
    defaultNext: key === 'platform' ? '/console' : '/dashboard',
    accessCookie: key === 'platform' ? PLATFORM_SESSION_COOKIE : SESSION_COOKIE,
    refreshCookie: key === 'platform' ? PLATFORM_REFRESH_COOKIE : REFRESH_COOKIE,
    flowCookie: key === 'platform' ? 'crm_platform_signin' : 'crm_signin',
    mePath: key === 'platform' ? '/api/v1/platform/me' : '/api/v1/me',
  };
}

/** Public address of the web app (behind Cloudflare the request host is internal). */
export function appUrl(): string {
  return required('WEB_APP_URL').replace(/\/+$/, '');
}

const secure = () => appUrl().startsWith('https://');

/** Only paths inside this app; anything else (other sites, //host, /\host) falls back to the default. */
export function safeNext(next: string | null | undefined, fallback: string): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}

// ---------------------------------------------------------------- encryption (refresh token, sign-in flow)
async function key(): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(required('SESSION_SECRET'))));
}

async function seal(value: unknown): Promise<string> {
  return new CompactEncrypt(new TextEncoder().encode(JSON.stringify(value))).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).encrypt(await key());
}

async function open<T>(sealed: string | undefined): Promise<T | null> {
  if (!sealed) return null;
  try {
    return JSON.parse(new TextDecoder().decode((await compactDecrypt(sealed, await key())).plaintext)) as T;
  } catch {
    return null;
  }
}

const randomText = () => base64url.encode(crypto.getRandomValues(new Uint8Array(32)));

// ---------------------------------------------------------------- Cognito endpoints
async function tokenRequest(p: Pool, form: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${p.domain}/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(p),
    },
    body: new URLSearchParams({ client_id: p.clientId, ...form }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Cognito token endpoint answered ${res.status}`);
  return (await res.json()) as Tokens;
}

/** Starts sign-in: PKCE verifier and state kept (encrypted) in a short-lived cookie, then off to Cognito. */
export async function startSignIn(key: PoolKey, next: string | null): Promise<Response> {
  const p = pool(key);
  const verifier = randomText();
  const state = randomText();
  const challenge = base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const url = new URL(`${p.domain}/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: appUrl() + p.callbackPath,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  const res = NextResponse.redirect(url);
  res.cookies.set(p.flowCookie, await seal({ state, verifier, next: safeNext(next, p.defaultNext) }), {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/auth',
    maxAge: FLOW_SECONDS,
  });
  return res;
}

/** Cognito came back: check the state, exchange the code, confirm the user with the API, set the session. */
export async function finishSignIn(key: PoolKey, params: URLSearchParams): Promise<Response> {
  const p = pool(key);
  const jar = await cookies();
  const flow = await open<{ state: string; verifier: string; next: string }>(jar.get(p.flowCookie)?.value);
  const fail = (error: string, message?: string) => {
    const url = new URL(appUrl() + p.signedOutPath);
    url.searchParams.set('error', error);
    if (message) url.searchParams.set('message', message.slice(0, 200));
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: p.flowCookie, path: '/auth' });
    return res;
  };

  if (params.get('error')) return fail('cognito', params.get('error_description') ?? params.get('error') ?? undefined);
  const code = params.get('code');
  if (!flow || !code || params.get('state') !== flow.state) return fail('expired');

  let tokens: Tokens;
  try {
    tokens = await tokenRequest(p, { grant_type: 'authorization_code', code, redirect_uri: appUrl() + p.callbackPath, code_verifier: flow.verifier });
  } catch {
    return fail('exchange');
  }

  // The login must belong to an active user (or owner-console admin) before entering the app.
  const me = await fetch(apiUrl() + p.mePath, { headers: { authorization: `Bearer ${tokens.access_token}` }, cache: 'no-store' });
  if (!me.ok) {
    const problem = (await me.json().catch(() => ({}))) as { detail?: string; title?: string };
    if (tokens.refresh_token) await revoke(p, tokens.refresh_token);
    return fail('access', problem.detail ?? problem.title);
  }

  const res = NextResponse.redirect(new URL(appUrl() + flow.next));
  res.cookies.delete({ name: p.flowCookie, path: '/auth' });
  await writeSession(res.cookies, p, tokens);
  return res;
}

type CookieWriter = { set: (name: string, value: string, options: Record<string, unknown>) => unknown };

async function writeSession(jar: CookieWriter, p: Pool, tokens: Tokens): Promise<void> {
  jar.set(p.accessCookie, tokens.access_token, { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/', maxAge: Math.max(60, tokens.expires_in - 60) });
  if (tokens.refresh_token) {
    jar.set(p.refreshCookie, await seal({ token: tokens.refresh_token }), { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/', maxAge: REFRESH_SECONDS });
  }
}

/**
 * The access token for an API call, renewed with the refresh token when it has run out (or when `force`, after
 * the API refused it). Route handlers only: the renewed token is written back to the cookie.
 */
export async function accessToken(key: PoolKey, force = false): Promise<string | undefined> {
  const p = pool(key);
  const jar = await cookies();
  const current = jar.get(p.accessCookie)?.value;
  if (current && !force) return current;
  const refresh = await open<{ token: string }>(jar.get(p.refreshCookie)?.value);
  if (!refresh) return undefined;
  try {
    const tokens = await tokenRequest(p, { grant_type: 'refresh_token', refresh_token: refresh.token });
    await writeSession(jar, p, tokens);
    return tokens.access_token;
  } catch {
    jar.delete(p.refreshCookie);
    jar.delete(p.accessCookie);
    return undefined;
  }
}

async function revoke(p: Pool, refreshToken: string): Promise<void> {
  await fetch(`${p.domain}/oauth2/revoke`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(p),
    },
    body: new URLSearchParams({ token: refreshToken, client_id: p.clientId }),
    cache: 'no-store',
  }).catch(() => undefined);
}

/** Sign-out: revoke the refresh token, clear the cookies, and end the Cognito session (the browser goes there next). */
export async function signOut(key: PoolKey): Promise<Response> {
  const p = pool(key);
  const jar = await cookies();
  const refresh = await open<{ token: string }>(jar.get(p.refreshCookie)?.value);
  if (refresh) await revoke(p, refresh.token);
  const logout = new URL(`${p.domain}/logout`);
  logout.search = new URLSearchParams({ client_id: p.clientId, logout_uri: appUrl() + p.signedOutPath }).toString();
  const res = NextResponse.json({ ok: true, redirect: logout.toString() });
  res.cookies.delete(p.accessCookie);
  res.cookies.delete(p.refreshCookie);
  return res;
}
