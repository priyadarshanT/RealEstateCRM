// Server-side settings for the web app. Read only in route handlers and middleware, never in the browser.

export const SESSION_COOKIE = 'crm_session';
/** Owner console login (our team only). A separate cookie: platform admins are not users of any company. */
export const PLATFORM_SESSION_COOKIE = 'crm_platform_session';

export function apiUrl(): string {
  return process.env.API_URL ?? 'http://localhost:4000';
}

export function authMode(): 'dev' | 'cognito' {
  return process.env.AUTH_MODE === 'cognito' ? 'cognito' : 'dev';
}
