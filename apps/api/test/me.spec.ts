import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetTestLogins, TENANT_A, TENANT_B, tokenFor } from './helpers';

// Runs against the local crm_dev database with the sample data loaded, connected as crm_app.
describe('login, tenant isolation and GET /me', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetTestLogins();
    app = await createTestApp();
  });

  afterEach(resetTestLogins);

  afterAll(async () => {
    await app.close();
  });

  it('GET /health answers without login', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
  });

  it('rejects a request without a token with problem+json 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/me').expect(401);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('rejects a token with a bad signature', async () => {
    const [header, payload, signature] = (await tokenFor(TENANT_A, 'admin@a.ae')).split('.');
    const token = [header, payload, [...signature!].reverse().join('')].join('.');
    await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('returns the Admin with company scope and export permission', async () => {
    const token = await tokenFor(TENANT_A, 'admin@a.ae');
    const res = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.user).toMatchObject({ email: 'admin@a.ae', status: 'active' });
    expect(res.body.tenant).toMatchObject({ id: TENANT_A, name: 'Al Noor Realty', type: 'brokerage' });
    expect(res.body.dataScope).toBe('company');
    expect(res.body.permissions).toContain('leads.export');
  });

  it('returns an agent with own scope and no export permission', async () => {
    const token = await tokenFor(TENANT_A, 'ali@a.ae');
    const res = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.dataScope).toBe('own');
    expect(res.body.permissions).not.toContain('leads.export');
  });

  it('keeps the login linked after the first request', async () => {
    const token = await tokenFor(TENANT_A, 'sara@a.ae');
    await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
    const again = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(again.body.user.email).toBe('sara@a.ae');
  });

  it("cannot reach another tenant's user: tenant B token with a tenant A email", async () => {
    const token = await tokenFor(TENANT_B, 'admin@a.ae');
    await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`).expect(401);
  });
});
