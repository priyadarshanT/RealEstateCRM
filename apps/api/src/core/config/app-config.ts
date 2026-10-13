import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';

// Environment settings. Locally from apps/api/.env; in AWS from SSM (injected as environment variables).
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    /** crm_worker (BYPASSRLS): only for the worker's cross-tenant scans and the job queue. */
    WORKER_DATABASE_URL: z.string().url().optional(),
    /** api (HTTP) or worker (background jobs and schedules); one codebase, two start modes. */
    APP_MODE: z.enum(['api', 'worker']).default('api'),
    /** File storage: S3 bucket in AWS (UAE region); locally MinIO with S3_ENDPOINT. */
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('me-central-1'),
    S3_ENDPOINT: z.string().url().optional(),
    /** Integration tokens: AWS SSM Parameter Store (staging/production) or memory (local development only). */
    SECRETS_MODE: z.enum(['ssm', 'memory']).default('memory'),
    /** Public addresses: OAuth redirect (API) and where the browser returns afterwards (screens). */
    PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
    WEB_APP_URL: z.string().url().default('http://localhost:3000'),
    /** Signs OAuth state values (single-use, 10 minutes). */
    OAUTH_STATE_SECRET: z.string().min(32).optional(),
    /** Meta app (lead ads): app ID and secret, and the token Meta sends when verifying the webhook. */
    META_APP_ID: z.string().optional(),
    META_APP_SECRET: z.string().optional(),
    META_VERIFY_TOKEN: z.string().optional(),
    META_GRAPH_VERSION: z.string().default('v21.0'),
    /** crm_platform (owner console, Stripe webhooks, billing records; architecture §6.3). */
    PLATFORM_DATABASE_URL: z.string().url().optional(),
    /** Owner console login: its own Cognito user pool (two-factor). Dev mode signs platform tokens locally. */
    PLATFORM_COGNITO_ISSUER: z.string().url().optional(),
    PLATFORM_COGNITO_CLIENT_ID: z.string().optional(),
    /** Cognito user pool of the CRM users (invite the first Admin at sign-up). */
    COGNITO_USER_POOL_ID: z.string().optional(),
    /** Stripe (cards and subscriptions). Test-mode keys locally and in staging. */
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().default('pk_test_placeholder'),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    /** Cloudflare Turnstile bot check on public sign-up and contact forms. */
    TURNSTILE_SECRET: z.string().optional(),
    /** Email: AWS SES in AWS; "log" writes emails to the server log (local development). */
    MAIL_MODE: z.enum(['ses', 'log']).default('log'),
    MAIL_FROM: z.string().default('Dubai Real Estate CRM <no-reply@crm.example.ae>'),
    /** PDF maker (Gotenberg 8, architecture §2). */
    GOTENBERG_URL: z.string().url().default('http://localhost:3001'),
    AUTH_MODE: z.enum(['cognito', 'dev']).default('cognito'),
    DEV_AUTH_SECRET: z.string().min(32).optional(),
    COGNITO_ISSUER: z.string().url().optional(),
    COGNITO_CLIENT_ID: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'dev' && !env.DEV_AUTH_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['DEV_AUTH_SECRET'], message: 'required when AUTH_MODE=dev' });
    }
    if (env.SECRETS_MODE === 'memory' && (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging')) {
      ctx.addIssue({ code: 'custom', path: ['SECRETS_MODE'], message: 'staging and production keep secrets in SSM' });
    }
    if (env.NODE_ENV === 'production' && !env.TURNSTILE_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['TURNSTILE_SECRET'], message: 'the bot check is required in production' });
    }
    if (env.AUTH_MODE === 'dev' && env.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', path: ['AUTH_MODE'], message: 'dev login is not allowed in production' });
    }
    if (env.AUTH_MODE === 'cognito' && (!env.COGNITO_ISSUER || !env.COGNITO_CLIENT_ID)) {
      ctx.addIssue({ code: 'custom', path: ['COGNITO_ISSUER'], message: 'COGNITO_ISSUER and COGNITO_CLIENT_ID are required' });
    }
  });

export type AppConfig = z.infer<typeof schema>;
export const APP_CONFIG = Symbol('APP_CONFIG');

/** Fills process.env from apps/api/.env when present. Variables already set (e.g. from SSM) win. */
export function loadEnvFile(): void {
  const file = resolve(__dirname, '../../../.env');
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) loadEnvFile();
  // An empty value (e.g. `S3_ENDPOINT=` copied from .env.example) means "not set", so defaults and optional fields apply.
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== '')));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
