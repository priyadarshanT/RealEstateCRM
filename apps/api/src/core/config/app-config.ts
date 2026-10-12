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
    AUTH_MODE: z.enum(['cognito', 'dev']).default('cognito'),
    DEV_AUTH_SECRET: z.string().min(32).optional(),
    COGNITO_ISSUER: z.string().url().optional(),
    COGNITO_CLIENT_ID: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'dev' && !env.DEV_AUTH_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['DEV_AUTH_SECRET'], message: 'required when AUTH_MODE=dev' });
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
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
