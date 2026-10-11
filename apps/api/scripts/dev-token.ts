// Local development only: prints a login token, standing in for Cognito.
// Usage: pnpm --filter @crm/api dev:token <tenantId> <email> [subject]
import { signDevToken } from '../src/core/auth/dev-token-verifier';
import { loadEnvFile } from '../src/core/config/app-config';

loadEnvFile();
const [tenantId, email, subject] = process.argv.slice(2);
const secret = process.env.DEV_AUTH_SECRET;
if (!tenantId || !email) {
  console.error('Usage: dev:token <tenantId> <email> [subject]');
  process.exit(1);
}
if (!secret) {
  console.error('DEV_AUTH_SECRET is not set in apps/api/.env');
  process.exit(1);
}
signDevToken(secret, { sub: subject ?? `dev|${email}`, tenantId, email }).then((t) => console.log(t));
