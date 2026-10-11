import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { signDevToken } from '../src/core/auth/dev-token-verifier';
import { loadConfig, loadEnvFile } from '../src/core/config/app-config';
import { configureApp } from '../src/main';

// Sample data from db/tests/sample_data.sql
export const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
export const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000001';

const TEST_SUBJECT_PREFIX = 'test|';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

/** A login token for the local dev identity provider, with a fresh subject so each test starts unlinked. */
export function tokenFor(tenantId: string, email: string): Promise<string> {
  const config = loadConfig();
  return signDevToken(config.DEV_AUTH_SECRET!, { sub: `${TEST_SUBJECT_PREFIX}${randomUUID()}`, tenantId, email });
}

/** Undo the login links the tests created on the sample users. Uses the owner connection (no row-level security). */
export async function resetTestLogins(): Promise<void> {
  loadEnvFile();
  const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`UPDATE users SET auth_subject = NULL WHERE auth_subject LIKE $1`, [`${TEST_SUBJECT_PREFIX}%`]);
  } finally {
    await client.end();
  }
}
