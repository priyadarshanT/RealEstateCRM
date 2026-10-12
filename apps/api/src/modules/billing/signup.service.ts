import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../../core/config/app-config';
import { DbService } from '../../core/database/db.service';
import { PlatformDbService } from '../../core/database/platform-db.service';
import { ProblemException, Problems } from '../../core/errors/problem';
import { MAILER, Mailer } from '../../core/mail/mailer';
import { OrganizationService } from '../organization/organization.service';
import { BOT_CHECK, BotCheck, IDENTITY_PROVIDER, IdentityProvider } from './adapters/services';
import { STRIPE_GATEWAY, StripeGateway } from './adapters/stripe-gateway';
import { addDays, BillingCoreService } from './billing-core.service';
import { salesEnquiries, SignupRow, signups, subscriptions } from './billing.schema';
import { CompleteSignupDto, SalesEnquiryInputDto, SignupCompleteDto, SignupDto, SignupStartDto } from './dto/billing.dto';

const CODE_MINUTES = 15;
const CODE_TRIES = 5;
const RESEND_SECONDS = 60;
const SIGNUP_HOURS = 24;

// users.email across all companies, for "email already registered" (read through the platform connection).
const usersEmail = pgTable('users', { email: text('email').notNull() });

const err = (status: number, code: string, title: string, detail: string) => new ProblemException(status, code, title, detail);

/**
 * Online sign-up with a free trial (SRS §12 "Signing up"): plan, licence (trade licence + RERA ORN for a brokerage,
 * RERA BRN for an agent), email confirmed with a 6-digit code, card saved with Stripe (required for the 14-day
 * trial; card details go straight to Stripe), then the company is created with default roles, stages and settings
 * and the person who signed up becomes its Admin. Our team checks the licence afterwards.
 */
@Injectable()
export class SignupService {
  constructor(
    private readonly core: BillingCoreService,
    private readonly organization: OrganizationService,
    private readonly db: DbService,
    private readonly platform: PlatformDbService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
    @Inject(BOT_CHECK) private readonly bot: BotCheck,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async start(body: SignupStartDto, ip?: string): Promise<SignupDto> {
    if (!(await this.bot.verify(body.turnstileToken, ip))) throw err(422, 'BOT_CHECK_FAILED', 'Please try again', 'The security check failed. Reload the page and try again.');
    const plan = await this.core.planByKey(body.planKey);
    if (!plan || !plan.isActive) throw Problems.validation([{ field: 'planKey', message: 'unknown plan' }]);
    if (!plan.selfService) throw err(422, 'PLAN_NOT_SELF_SERVICE', 'Talk to our sales team', `The ${plan.name} plan is arranged through our sales team.`);
    if (plan.tenantType && plan.tenantType !== body.tenantType) {
      throw err(422, 'PLAN_NOT_ALLOWED', 'Plan not available', `The ${plan.name} plan is for ${plan.tenantType === 'individual' ? 'individual agents' : 'brokerages'}.`);
    }
    const missing = body.tenantType === 'brokerage' ? (['tradeLicenseNo', 'reraOrn'] as const).filter((f) => !body[f]?.trim()) : body.reraBrn?.trim() ? [] : (['reraBrn'] as const);
    if (missing.length) {
      throw new ProblemException(422, 'LICENCE_REQUIRED', 'Licence required', body.tenantType === 'brokerage' ? 'A brokerage needs its trade licence number and RERA office number (ORN).' : 'An agent needs a RERA broker card number (BRN).', missing.map((field) => ({ field, message: 'required' })));
    }
    const seats = body.tenantType === 'individual' ? 1 : (body.seats ?? plan.minSeats);
    if (seats < plan.minSeats || (plan.maxSeats !== null && seats > plan.maxSeats)) {
      throw Problems.validation([{ field: 'seats', message: `this plan allows ${plan.minSeats}${plan.maxSeats ? `–${plan.maxSeats}` : ' or more'} users` }]);
    }
    if (await this.emailTaken(body.adminEmail)) throw err(409, 'EMAIL_ALREADY_REGISTERED', 'Email already registered', 'This email already has an account. Sign in instead.');

    const id = randomUUID();
    const code = sixDigits();
    const customerId = await this.stripe.createCustomer({ email: body.adminEmail, name: body.companyName, metadata: { signupId: id } });
    const setup = await this.stripe.createSetupIntent(customerId);
    const now = new Date();
    const [row] = await this.platform.db
      .insert(signups)
      .values({
        id,
        tenantType: body.tenantType,
        companyName: body.companyName.trim(),
        tradeLicenseNo: body.tenantType === 'brokerage' ? body.tradeLicenseNo!.trim() : null,
        reraOrn: body.tenantType === 'brokerage' ? body.reraOrn!.trim() : null,
        reraBrn: body.tenantType === 'individual' ? body.reraBrn!.trim() : (body.reraBrn?.trim() ?? null),
        adminFullName: body.adminFullName.trim(),
        adminEmail: body.adminEmail,
        adminPhone: body.adminPhone,
        planId: plan.id,
        seats,
        billingCycle: body.billingCycle,
        codeHash: hash(id, code),
        codeExpiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000),
        stripeCustomerId: customerId,
        stripeSetupIntentId: setup.id,
        ipAddress: ip ?? null,
        expiresAt: new Date(now.getTime() + SIGNUP_HOURS * 3_600_000),
      })
      .returning();
    await this.sendCode(row!, code);
    return this.dto(row!, setup.clientSecret);
  }

  async verifyEmail(id: string, code: string): Promise<SignupDto> {
    const row = await this.open(id);
    if (row.emailVerifiedAt) return this.dto(row);
    if (row.codeAttempts >= CODE_TRIES || row.codeExpiresAt < new Date()) {
      throw err(422, 'CODE_EXPIRED', 'Code expired', 'This code has expired. Ask for a new one.');
    }
    if (hash(id, code) !== row.codeHash) {
      await this.platform.db.update(signups).set({ codeAttempts: sql`${signups.codeAttempts} + 1` }).where(eq(signups.id, id));
      throw err(422, 'CODE_INVALID', 'Wrong code', `The code is not correct. ${CODE_TRIES - row.codeAttempts - 1} tries left.`);
    }
    const [after] = await this.platform.db.update(signups).set({ emailVerifiedAt: new Date() }).where(eq(signups.id, id)).returning();
    return this.dto(after!);
  }

  async resendCode(id: string): Promise<void> {
    const row = await this.open(id);
    if (row.emailVerifiedAt) return;
    if (Date.now() - row.codeSentAt.getTime() < RESEND_SECONDS * 1000) {
      throw err(429, 'TOO_MANY_REQUESTS', 'Please wait', 'A new code can be sent once a minute.');
    }
    const code = sixDigits();
    const [after] = await this.platform.db
      .update(signups)
      .set({ codeHash: hash(id, code), codeAttempts: 0, codeSentAt: new Date(), codeExpiresAt: new Date(Date.now() + CODE_MINUTES * 60_000) })
      .where(eq(signups.id, id))
      .returning();
    await this.sendCode(after!, code);
  }

  /** Step 3: card saved → the company, its Admin and a 14-day trial (card required). */
  async complete(id: string, body: CompleteSignupDto): Promise<SignupCompleteDto> {
    const [existing] = await this.platform.db.select().from(signups).where(eq(signups.id, id)).limit(1);
    if (existing?.completedAt && existing.tenantId) {
      const sub = await this.core.subscriptionOf(existing.tenantId);
      return { tenantId: existing.tenantId, trialEndsAt: sub!.trialEndsAt!.toISOString(), loginUrl: this.loginUrl() };
    }
    const row = await this.open(id);
    if (!row.emailVerifiedAt) throw err(422, 'EMAIL_NOT_VERIFIED', 'Email not confirmed', 'Enter the code we emailed you first.');
    const intent = body.setupIntentId === row.stripeSetupIntentId ? await this.stripe.getSetupIntent(body.setupIntentId) : undefined;
    if (!intent || intent.status !== 'succeeded' || intent.customerId !== row.stripeCustomerId || !intent.paymentMethodId) {
      throw err(422, 'CARD_REQUIRED', 'Card required', 'A card is needed to start the 14-day free trial.');
    }
    await this.stripe.setDefaultCard(row.stripeCustomerId!, intent.paymentMethodId);

    const plan = await this.core.plan(row.planId);
    const settings = await this.core.settings();
    const trialEndsAt = addDays(new Date(), settings.trialDays);
    const price = BillingCoreService.price(plan, row.billingCycle);
    const tenantId = randomUUID();
    const stripeSub = await this.stripe.createSubscription({
      customerId: row.stripeCustomerId!,
      seats: row.seats,
      unitAmount: price,
      currency: plan.currency,
      interval: row.billingCycle === 'yearly' ? 'year' : 'month',
      productName: `${plan.name} plan`,
      trialEnd: trialEndsAt,
      collection: 'charge_automatically',
      metadata: { tenantId },
    });

    await this.db.withTenant(tenantId, async () => {
      await this.organization.createCompany({
        tenantId,
        type: row.tenantType,
        name: row.companyName,
        tradeLicenseNo: row.tradeLicenseNo,
        reraOrn: row.reraOrn,
        reraBrn: row.reraBrn,
        email: row.adminEmail,
        phone: row.adminPhone,
        adminFullName: row.adminFullName,
        adminEmail: row.adminEmail,
        adminPhone: row.adminPhone,
      });
      const [sub] = await this.db.current
        .insert(subscriptions)
        .values({
          tenantId,
          planId: plan.id,
          status: 'trialing',
          billingCycle: row.billingCycle,
          seats: row.seats,
          pricePerSeat: price,
          currency: plan.currency,
          paymentMethod: 'card',
          cardOnFile: true,
          trialEndsAt,
          currentPeriodStart: stripeSub.currentPeriodStart,
          currentPeriodEnd: trialEndsAt,
          stripeCustomerId: row.stripeCustomerId,
          stripeSubscriptionId: stripeSub.id,
        })
        .returning();
      await this.core.event(this.db.current, sub!, 'trial_started', { type: 'system' }, null, { plan: plan.key, seats: row.seats, trialEndsAt: trialEndsAt.toISOString() });
    });
    await this.platform.db.update(signups).set({ tenantId, completedAt: new Date() }).where(eq(signups.id, id));
    await this.identity.inviteUser({ email: row.adminEmail, fullName: row.adminFullName, tenantId });
    await this.mailer.send({
      to: row.adminEmail,
      subject: 'Welcome to the CRM: your 14-day free trial has started',
      text: `Hello ${row.adminFullName},\n\nYour company ${row.companyName} is ready. Your free trial ends on ${trialEndsAt.toISOString().slice(0, 10)}.\nSign in: ${this.loginUrl()}\n\nOur team will check your ${row.tenantType === 'brokerage' ? 'trade licence and RERA ORN' : 'RERA broker card'} shortly.`,
    });
    return { tenantId, trialEndsAt: trialEndsAt.toISOString(), loginUrl: this.loginUrl() };
  }

  /** "Talk to sales" (Enterprise). Only inserted; the owner console follows it up. */
  async contactSales(body: SalesEnquiryInputDto, ip?: string): Promise<void> {
    if (!(await this.bot.verify(body.turnstileToken ?? '', ip))) throw err(422, 'BOT_CHECK_FAILED', 'Please try again', 'The security check failed. Reload the page and try again.');
    await this.platform.db.insert(salesEnquiries).values({
      companyName: body.companyName,
      contactName: body.contactName,
      email: body.email,
      phone: body.phone ?? null,
      usersEstimate: body.usersEstimate ?? null,
      message: body.message ?? null,
    });
  }

  private async open(id: string): Promise<SignupRow> {
    const [row] = await this.platform.db
      .select()
      .from(signups)
      .where(and(eq(signups.id, id), isNull(signups.completedAt), gt(signups.expiresAt, new Date())))
      .limit(1);
    if (!row) throw Problems.notFound('This sign-up has expired. Please start again.');
    return row;
  }

  private async emailTaken(email: string): Promise<boolean> {
    const rows = await this.platform.db.select({ email: usersEmail.email }).from(usersEmail).where(sql`${usersEmail.email} = ${email}::citext`).limit(1);
    return rows.length > 0;
  }

  private async sendCode(row: SignupRow, code: string): Promise<void> {
    await this.mailer.send({
      to: row.adminEmail,
      subject: `${code} is your confirmation code`,
      text: `Your confirmation code is ${code}. It is valid for ${CODE_MINUTES} minutes.`,
    });
  }

  private dto(row: SignupRow, clientSecret?: string): SignupDto {
    return {
      signupId: row.id,
      emailVerified: Boolean(row.emailVerifiedAt),
      cardSetup: { stripePublishableKey: this.config.STRIPE_PUBLISHABLE_KEY, setupIntentClientSecret: clientSecret ?? '' },
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  private loginUrl(): string {
    return `${this.config.WEB_APP_URL}/login`;
  }
}

function sixDigits(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function hash(id: string, code: string): string {
  return createHash('sha256').update(`${id}:${code}`).digest('hex');
}
