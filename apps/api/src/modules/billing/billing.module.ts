import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../core/config/app-config';
import { SUBSCRIPTION_STATUS } from '../../core/auth/principal';
import { LeadsModule } from '../leads/leads.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationModule } from '../organization/organization.module';
import { ReportsModule } from '../reports/reports.module';
import {
  BOT_CHECK,
  CognitoIdentityProvider,
  DevBotCheck,
  DevIdentityProvider,
  GotenbergRenderer,
  IDENTITY_PROVIDER,
  PDF_RENDERER,
  TurnstileBotCheck,
} from './adapters/services';
import { STRIPE_GATEWAY, StripeSdkGateway, unconfiguredStripe } from './adapters/stripe-gateway';
import { BillingCoreService } from './billing-core.service';
import { BillingJobs } from './billing-jobs';
import { BillingController, PublicSignupController } from './billing.controller';
import { BillingService } from './billing.service';
import { SignupService } from './signup.service';
import { StripeEventProcessor, StripeWebhookController } from './stripe-events';

/** Plans, sign-up, trials, seats, Stripe, our VAT invoices, grace and read-only (SRS §12; architecture "billing"). */
@Module({
  imports: [OrganizationModule, NotificationsModule, LeadsModule, ReportsModule],
  controllers: [PublicSignupController, BillingController, StripeWebhookController],
  providers: [
    BillingCoreService,
    BillingService,
    SignupService,
    StripeEventProcessor,
    BillingJobs,
    { provide: SUBSCRIPTION_STATUS, useExisting: BillingCoreService },
    {
      provide: STRIPE_GATEWAY,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => (c.STRIPE_SECRET_KEY ? new StripeSdkGateway(c.STRIPE_SECRET_KEY, c.STRIPE_WEBHOOK_SECRET) : unconfiguredStripe()),
    },
    { provide: BOT_CHECK, inject: [APP_CONFIG], useFactory: (c: AppConfig) => (c.TURNSTILE_SECRET ? new TurnstileBotCheck(c.TURNSTILE_SECRET) : new DevBotCheck()) },
    {
      provide: IDENTITY_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => (c.AUTH_MODE === 'cognito' && c.COGNITO_USER_POOL_ID ? new CognitoIdentityProvider(c.S3_REGION, c.COGNITO_USER_POOL_ID) : new DevIdentityProvider()),
    },
    { provide: PDF_RENDERER, inject: [APP_CONFIG], useFactory: (c: AppConfig) => new GotenbergRenderer(c.GOTENBERG_URL) },
  ],
  exports: [BillingCoreService, BillingService, SignupService, SUBSCRIPTION_STATUS, STRIPE_GATEWAY, IDENTITY_PROVIDER],
})
export class BillingModule {}
