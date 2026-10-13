import { loadConfig } from '../src/core/config/app-config';

// Environment settings: apps/api/.env copied from .env.example must load with its empty lines left in.
describe('configuration', () => {
  const base = {
    DATABASE_URL: 'postgres://crm_app:secret@localhost:5432/crm_dev',
    AUTH_MODE: 'dev',
    DEV_AUTH_SECRET: 'x'.repeat(32),
  };

  it('treats empty values as not set', () => {
    const config = loadConfig({ ...base, S3_ENDPOINT: '', COGNITO_ISSUER: '', STRIPE_PUBLISHABLE_KEY: '', PORT: '' });
    expect(config.S3_ENDPOINT).toBeUndefined();
    expect(config.COGNITO_ISSUER).toBeUndefined();
    expect(config.STRIPE_PUBLISHABLE_KEY).toBe('pk_test_placeholder');
    expect(config.PORT).toBe(4000);
  });

  it('still rejects a value that is set but invalid', () => {
    expect(() => loadConfig({ ...base, S3_ENDPOINT: 'not a url' })).toThrow('S3_ENDPOINT');
  });

  it('still requires what is required', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: '' })).toThrow('DATABASE_URL');
  });
});
