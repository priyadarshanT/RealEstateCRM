import { randomBytes } from 'node:crypto';

export type CalendarProvider = 'google_workspace' | 'microsoft_365';
export const CALENDAR_PROVIDERS: CalendarProvider[] = ['google_workspace', 'microsoft_365'];

/** Tokens for one agent's calendar; expiresAt in epoch milliseconds. */
export interface CalendarTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

/**
 * Sign-in with Google or Microsoft for an agent's own calendar (SRS §3.8, §3.13): consent screen, code exchange
 * and refresh of the one-hour access token. One adapter per provider behind this port; locally
 * (CALENDAR_MODE=simulate) the consent screen is skipped and stand-in tokens are issued.
 */
export interface CalendarOAuth {
  configured(provider: CalendarProvider): boolean;
  authorizeUrl(provider: CalendarProvider, state: string, redirectUri: string): string;
  exchange(provider: CalendarProvider, code: string, redirectUri: string): Promise<CalendarTokens & { email: string }>;
  refresh(provider: CalendarProvider, refreshToken: string): Promise<CalendarTokens>;
}
export const CALENDAR_OAUTH = Symbol('CALENDAR_OAUTH');

interface Client {
  id: string;
  secret: string;
}

const ENDPOINTS: Record<CalendarProvider, { authorize: string; token: string; scope: string }> = {
  google_workspace: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email https://www.googleapis.com/auth/calendar.events',
  },
  microsoft_365: {
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid email offline_access User.Read Calendars.ReadWrite OnlineMeetings.ReadWrite',
  },
};

export class LiveCalendarOAuth implements CalendarOAuth {
  constructor(private readonly clients: Partial<Record<CalendarProvider, Client>>) {}

  configured(provider: CalendarProvider): boolean {
    return !!this.clients[provider];
  }

  authorizeUrl(provider: CalendarProvider, state: string, redirectUri: string): string {
    const q = new URLSearchParams({ client_id: this.client(provider).id, redirect_uri: redirectUri, response_type: 'code', scope: ENDPOINTS[provider].scope, state });
    // Google returns a refresh token only with offline access and a fresh consent.
    if (provider === 'google_workspace') q.set('access_type', 'offline'), q.set('prompt', 'consent');
    else q.set('prompt', 'select_account');
    return `${ENDPOINTS[provider].authorize}?${q}`;
  }

  async exchange(provider: CalendarProvider, code: string, redirectUri: string): Promise<CalendarTokens & { email: string }> {
    const json = await this.token(provider, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
    const claims = json.id_token ? idTokenClaims(json.id_token) : {};
    const email = claims.email ?? claims.preferred_username;
    if (!email) throw new Error('The account did not share its email address');
    if (!json.refresh_token) throw new Error('No refresh token was returned; remove the CRM from the account\'s connected apps and connect again');
    return { ...tokens(json), email };
  }

  async refresh(provider: CalendarProvider, refreshToken: string): Promise<CalendarTokens> {
    return tokens(await this.token(provider, { grant_type: 'refresh_token', refresh_token: refreshToken }));
  }

  private client(provider: CalendarProvider): Client {
    const c = this.clients[provider];
    if (!c) throw new Error(`${provider === 'google_workspace' ? 'Google' : 'Microsoft'} sign-in is not set up on the server`);
    return c;
  }

  private async token(provider: CalendarProvider, params: Record<string, string>): Promise<TokenResponse> {
    const c = this.client(provider);
    const res = await fetch(ENDPOINTS[provider].token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...params, ...(provider === 'microsoft_365' ? { scope: ENDPOINTS[provider].scope } : {}) }),
    });
    const json = (await res.json()) as TokenResponse;
    if (!res.ok || !json.access_token) throw new Error(`${provider === 'google_workspace' ? 'Google' : 'Microsoft'} sign-in: ${json.error_description ?? json.error ?? res.statusText}`);
    return json;
  }
}

/** CALENDAR_MODE=simulate: the "consent screen" returns straight to the callback; tokens are stand-ins. */
export class SimulatedCalendarOAuth implements CalendarOAuth {
  configured(): boolean {
    return true;
  }

  authorizeUrl(_provider: CalendarProvider, state: string, redirectUri: string): string {
    return `${redirectUri}?${new URLSearchParams({ code: 'simulated', state })}`;
  }

  async exchange(provider: CalendarProvider): Promise<CalendarTokens & { email: string }> {
    return { ...this.issue(), email: `${provider === 'google_workspace' ? 'google' : 'microsoft'}.calendar@example.com` };
  }

  async refresh(): Promise<CalendarTokens> {
    return this.issue();
  }

  private issue(): CalendarTokens {
    return { accessToken: `sim-${randomBytes(8).toString('hex')}`, refreshToken: `sim-refresh-${randomBytes(8).toString('hex')}`, expiresAt: Date.now() + 3_600_000 };
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
}

function tokens(json: TokenResponse): CalendarTokens {
  return { accessToken: json.access_token!, ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}), expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
}

/** The id_token comes straight from the provider's token endpoint over TLS, so its claims are read, not verified. */
function idTokenClaims(idToken: string): { email?: string; preferred_username?: string } {
  try {
    return JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}
