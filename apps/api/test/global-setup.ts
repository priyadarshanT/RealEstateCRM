// Jest global setup: rebuild crm_test from the migrations, then load the sample data used by the tests.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { loadEnvFile } from '../src/core/config/app-config';
import { runMigrations } from '../src/core/database/migrations';
import { TEST_DATABASE, withDatabase } from './test-db';

export default async function globalSetup(): Promise<void> {
  loadEnvFile();
  const owner = process.env.MIGRATION_DATABASE_URL;
  if (!owner) throw new Error('MIGRATION_DATABASE_URL must be set in apps/api/.env');

  const admin = new Client({ connectionString: withDatabase(owner, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DATABASE}`);
  } finally {
    await admin.end();
  }

  const testUrl = withDatabase(owner, TEST_DATABASE);
  await runMigrations(testUrl);
  const client = new Client({ connectionString: testUrl });
  await client.connect();
  try {
    await client.query(readFileSync(resolve(__dirname, '../../../db/tests/sample_data.sql'), 'utf8'));
  } finally {
    await client.end();
  }
}
