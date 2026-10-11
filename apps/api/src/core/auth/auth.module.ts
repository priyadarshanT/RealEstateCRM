import { Global, Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { RateLimitGuard } from '../http/rate-limit';
import { CognitoTokenVerifier } from './cognito-token-verifier';
import { DevTokenVerifier } from './dev-token-verifier';
import { AuthGuard, PermissionGuard, SubscriptionGuard } from './guards';
import { TOKEN_VERIFIER } from './principal';

@Global()
@Module({
  providers: [
    {
      provide: TOKEN_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.AUTH_MODE === 'dev'
          ? new DevTokenVerifier(config.DEV_AUTH_SECRET!)
          : new CognitoTokenVerifier(config.COGNITO_ISSUER!, config.COGNITO_CLIENT_ID!),
    },
  ],
  exports: [TOKEN_VERIFIER],
})
export class AuthModule {}

/**
 * Registered in AppModule (the composition root), where the business modules that implement
 * PRINCIPAL_RESOLVER and SUBSCRIPTION_STATUS are visible.
 * Order: login + tenant, rate limit (per user), permission, subscription.
 */
export const requestGuards: Provider[] = [
  { provide: APP_GUARD, useClass: AuthGuard },
  { provide: APP_GUARD, useClass: RateLimitGuard },
  { provide: APP_GUARD, useClass: PermissionGuard },
  { provide: APP_GUARD, useClass: SubscriptionGuard },
];
