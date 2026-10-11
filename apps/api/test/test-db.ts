import { loadEnvFile } from '../src/core/config/app-config';

// Tests run against their own database, rebuilt on every run, so crm_dev is never touched.
export const TEST_DATABASE = 'crm_test';

export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/** Points DATABASE_URL and MIGRATION_DATABASE_URL at the test database. */
export function useTestDatabase(): void {
  loadEnvFile();
  const app = process.env.DATABASE_URL;
  const owner = process.env.MIGRATION_DATABASE_URL;
  if (!app || !owner) throw new Error('DATABASE_URL and MIGRATION_DATABASE_URL must be set in apps/api/.env');
  process.env.DATABASE_URL = withDatabase(app, TEST_DATABASE);
  process.env.MIGRATION_DATABASE_URL = withDatabase(owner, TEST_DATABASE);
}
