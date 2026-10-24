// Server-side settings for the web app. Read only in route handlers and middleware, never in the browser.

export const SESSION_COOKIE = 'crm_session';
/** Owner console login (our team only). A separate cookie: platform admins are not users of any company. */
export const PLATFORM_SESSION_COOKIE = 'crm_platform_session';
/** Cognito refresh tokens (encrypted), which renew an expired session cookie (core/oidc.ts). */
export const REFRESH_COOKIE = 'crm_refresh';
export const PLATFORM_REFRESH_COOKIE = 'crm_platform_refresh';

export function apiUrl(): string {
  return process.env.API_URL ?? 'http://localhost:4000';
}

export function authMode(): 'dev' | 'cognito' {
  return process.env.AUTH_MODE === 'cognito' ? 'cognito' : 'dev';
}

/** Cloudflare Turnstile site key (public) for the bot check on the public forms; unset locally. */
export function turnstileSiteKey(): string | undefined {
  return process.env.TURNSTILE_SITE_KEY || undefined;
}
