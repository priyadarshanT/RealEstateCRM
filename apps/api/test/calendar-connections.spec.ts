import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DbService } from '../src/core/database/db.service';
import { CalendarSyncService } from '../src/modules/calendar/calendar-sync.service';
import { CALENDAR_OAUTH, CalendarOAuth, CalendarProvider, CalendarTokens } from '../src/modules/integrations/adapters/calendar-oauth';
import { IntegrationsService } from '../src/modules/integrations/integrations.service';
import { createTestApp, ownerQuery, signIn, TENANT_A, USERS } from './helpers';

/** Google / Microsoft as the tests need them: codes become tokens; refresh can be made to fail. */
class FakeCalendarOAuth implements CalendarOAuth {
  refreshes = 0;
  refuseRefresh = false;
  expiresIn = 3_600_000;
  configured(): boolean {
    return true;
  }
  authorizeUrl(provider: CalendarProvider, state: string, redirectUri: string): string {
    return `https://consent.example/${provider}?${new URLSearchParams({ state, redirect_uri: redirectUri })}`;
  }
  async exchange(_provider: CalendarProvider, code: string): Promise<CalendarTokens & { email: string }> {
    return { accessToken: `access-${code}`, refreshToken: `refresh-${code}`, expiresAt: Date.now() + this.expiresIn, email: 'Mira.Calendar@Example.com' };
  }
  async refresh(_provider: CalendarProvider, refreshToken: string): Promise<CalendarTokens> {
    this.refreshes += 1;
    if (this.refuseRefresh) throw new Error('invalid_grant');
    return { accessToken: `access-refreshed-${this.refreshes}`, expiresAt: Date.now() + 3_600_000, ...(refreshToken ? {} : {}) };
  }
}

// Each agent connects their own Google / Microsoft calendar (SRS §3.8, §3.13): consent, tokens kept in the secret
// store and refreshed before they expire, a calendar check every 10 minutes, and disconnect by its owner only.
describe('calendar connections', () => {
  let app: INestApplication;
  let admin: Awaited<ReturnType<typeof signIn>>;
  let agent: Awaited<ReturnType<typeof signIn>>;
  let calendarId: string;
  const oauth = new FakeCalendarOAuth();
  const server = () => app.getHttpServer();
  const withRow = <T>(work: (s: IntegrationsService, row: Awaited<ReturnType<IntegrationsService['get']>>) => Promise<T>) =>
    app.get(DbService).withTenant(TENANT_A, async () => work(app.get(IntegrationsService), await app.get(IntegrationsService).get(calendarId)));

  beforeAll(async () => {
    app = await createTestApp((b) => b.overrideProvider(CALENDAR_OAUTH).useValue(oauth));
    admin = await signIn(app, USERS.adminA);
    agent = await signIn(app, USERS.miraA); // not Ali: inbound.spec looks up Ali's Google calendar by user
  });

  afterAll(async () => {
    await ownerQuery(`UPDATE integrations SET status = 'disconnected' WHERE id = $1`, [calendarId]);
    await app.close();
  });

  it('an agent without settings permission connects their own Google calendar through the consent screen', async () => {
    await agent.post('/api/v1/integrations').send({ provider: 'google_workspace', scope: 'user' }).expect(403);
    await agent.post('/api/v1/me/calendars').send({ provider: 'gmail' }).expect(400);
    const start = (await agent.post('/api/v1/me/calendars').send({ provider: 'google_workspace' }).expect(201)).body;
    calendarId = start.integrationId;
    const consent = new URL(start.authorizeUrl);
    expect(consent.searchParams.get('redirect_uri')).toBe('http://localhost:4000/api/v1/oauth/google_workspace/callback');

    const bad = await request(server()).get('/api/v1/oauth/google_workspace/callback').query({ code: 'c1', state: `${consent.searchParams.get('state')}x` }).expect(302);
    expect(bad.headers.location).toBe('http://localhost:3000/tasks?calendarError=invalid_state');
    const ok = await request(server()).get('/api/v1/oauth/google_workspace/callback').query({ code: 'c1', state: consent.searchParams.get('state') }).expect(302);
    expect(ok.headers.location).toBe('http://localhost:3000/tasks?calendarConnected=google_workspace');
    // The state is single-use.
    await request(server()).get('/api/v1/oauth/google_workspace/callback').query({ code: 'c1', state: consent.searchParams.get('state') }).expect(302);

    const mine = (await agent.get('/api/v1/me/calendars').expect(200)).body.data;
    expect(mine).toEqual([expect.objectContaining({ id: calendarId, provider: 'google_workspace', scope: 'user', userId: USERS.miraA.id, status: 'connected', accountLabel: 'mira.calendar@example.com' })]);
    expect((await admin.get('/api/v1/me/calendars').expect(200)).body.data).toEqual([]);
    const stored = await ownerQuery<{ settings: string }>(`SELECT settings::text FROM integrations WHERE id = $1`, [calendarId]);
    expect(stored[0]!.settings).not.toContain('access-c1');
  });

  it('the access token is refreshed shortly before it expires, and kept until then', async () => {
    expect((await withRow((s, row) => s.calendarCredentials(row))).accessToken).toBe('access-c1');
    expect(oauth.refreshes).toBe(0);
    oauth.expiresIn = 60_000; // connect again: a token that expires within two minutes
    const start = (await agent.post('/api/v1/me/calendars').send({ provider: 'google_workspace' }).expect(201)).body;
    expect(start.integrationId).toBe(calendarId); // one connection per user and provider
    await request(server()).get('/api/v1/oauth/google_workspace/callback').query({ code: 'c2', state: new URL(start.authorizeUrl).searchParams.get('state') }).expect(302);
    const refreshed = await withRow((s, row) => s.calendarCredentials(row));
    expect(refreshed).toMatchObject({ accessToken: 'access-refreshed-1', refreshToken: 'refresh-c2' });
    expect((await withRow((s, row) => s.calendarCredentials(row))).accessToken).toBe('access-refreshed-1');
    expect(oauth.refreshes).toBe(1);
  });

  it('a refused refresh marks the connection to be connected again; the 10-minute check carries on', async () => {
    oauth.expiresIn = 60_000;
    const start = (await agent.post('/api/v1/me/calendars').send({ provider: 'google_workspace' }).expect(201)).body;
    await request(server()).get('/api/v1/oauth/google_workspace/callback').query({ code: 'c3', state: new URL(start.authorizeUrl).searchParams.get('state') }).expect(302);
    oauth.refuseRefresh = true;
    await expect(app.get(CalendarSyncService).checkAll()).resolves.toBeUndefined();
    const [row] = await ownerQuery<{ status: string; last_error: string }>(`SELECT status, last_error FROM integrations WHERE id = $1`, [calendarId]);
    expect(row).toEqual({ status: 'error', last_error: expect.stringContaining('Sign-in expired, connect again') });
  });

  it('only its owner disconnects a calendar', async () => {
    await admin.delete(`/api/v1/me/calendars/${calendarId}`).expect(404);
    await agent.delete(`/api/v1/me/calendars/${calendarId}`).expect(204);
    expect((await agent.get('/api/v1/me/calendars').expect(200)).body.data).toEqual([]);
  });
});
