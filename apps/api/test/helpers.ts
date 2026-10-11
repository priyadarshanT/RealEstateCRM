import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { signDevToken } from '../src/core/auth/dev-token-verifier';
import { loadConfig } from '../src/core/config/app-config';
import { configureApp } from '../src/main';
import { useTestDatabase } from './test-db';

useTestDatabase();

// Sample data from db/tests/sample_data.sql (tenant A: 4 paid seats, 4 active users)
export const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
export const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000001';
export const USERS = {
  adminA: { id: 'a0000000-0000-0000-0000-00000000000a', email: 'admin@a.ae', tenant: TENANT_A },
  saraA: { id: 'a0000000-0000-0000-0000-00000000000b', email: 'sara@a.ae', tenant: TENANT_A },
  aliA: { id: 'a0000000-0000-0000-0000-00000000000c', email: 'ali@a.ae', tenant: TENANT_A },
  miraA: { id: 'a0000000-0000-0000-0000-00000000000d', email: 'mira@a.ae', tenant: TENANT_A },
  adminB: { id: 'b0000000-0000-0000-0000-00000000000a', email: 'admin@b.ae', tenant: TENANT_B },
} as const;

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

/**
 * A login token from the local dev identity provider. One login per user (users.auth_subject is unique),
 * so the subject is stable per email; a random subject simulates a different person's login.
 */
export function tokenFor(tenantId: string, email: string, subject = `dev|${email}`): Promise<string> {
  return signDevToken(loadConfig().DEV_AUTH_SECRET!, { sub: subject, tenantId, email });
}

/** Signs in once and returns a supertest agent wrapper that sends the token. */
export async function signIn(app: INestApplication, who: { email: string; tenant: string }) {
  const token = await tokenFor(who.tenant, who.email);
  const auth = { Authorization: `Bearer ${token}` };
  const server = app.getHttpServer();
  return {
    get: (url: string) => request(server).get(url).set(auth),
    post: (url: string) => request(server).post(url).set(auth),
    put: (url: string) => request(server).put(url).set(auth),
    patch: (url: string) => request(server).patch(url).set(auth),
    delete: (url: string) => request(server).delete(url).set(auth),
  };
}

/** Owner connection to the test database (no row-level security), for checks that bypass the API. */
export async function ownerQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}
