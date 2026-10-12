import { AdminCreateUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { Logger } from '@nestjs/common';

/** Cloudflare Turnstile bot check on public forms (API guide §10). */
export interface BotCheck {
  verify(token: string, ip?: string): Promise<boolean>;
}
export const BOT_CHECK = Symbol('BOT_CHECK');

export class TurnstileBotCheck implements BotCheck {
  constructor(private readonly secret: string) {}

  async verify(token: string, ip?: string): Promise<boolean> {
    const body = new URLSearchParams({ secret: this.secret, response: token, ...(ip ? { remoteip: ip } : {}) });
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    return ((await res.json()) as { success?: boolean }).success === true;
  }
}

/** Local development and tests without a Turnstile secret: any non-empty token passes (refused in production by config). */
export class DevBotCheck implements BotCheck {
  async verify(token: string): Promise<boolean> {
    return token.length > 0 && token !== 'fail';
  }
}

/** The login provider's admin side: creates the first Admin of a new company (Cognito sends the invitation). */
export interface IdentityProvider {
  inviteUser(input: { email: string; fullName: string; tenantId: string }): Promise<void>;
}
export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

export class CognitoIdentityProvider implements IdentityProvider {
  private readonly cognito: CognitoIdentityProviderClient;

  constructor(
    region: string,
    private readonly userPoolId: string,
  ) {
    this.cognito = new CognitoIdentityProviderClient({ region });
  }

  async inviteUser(input: { email: string; fullName: string; tenantId: string }): Promise<void> {
    await this.cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        Username: input.email,
        UserAttributes: [
          { Name: 'email', Value: input.email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: input.fullName },
          { Name: 'custom:tenant_id', Value: input.tenantId },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );
  }
}

/** Local development: no identity provider; the user signs in with a dev token (pnpm dev:token). */
export class DevIdentityProvider implements IdentityProvider {
  private readonly logger = new Logger('Identity');
  async inviteUser(input: { email: string; tenantId: string }): Promise<void> {
    this.logger.log(`invite ${input.email} to tenant ${input.tenantId} (use pnpm dev:token ${input.tenantId} ${input.email})`);
  }
}

/** HTML to PDF (Gotenberg 8, architecture §2): invoices and tax invoices. */
export interface PdfRenderer {
  render(html: string): Promise<Buffer>;
}
export const PDF_RENDERER = Symbol('PDF_RENDERER');

export class GotenbergRenderer implements PdfRenderer {
  constructor(private readonly url: string) {}

  async render(html: string): Promise<Buffer> {
    const form = new FormData();
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
    const res = await fetch(`${this.url}/forms/chromium/convert/html`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Gotenberg ${res.status}: ${await res.text().catch(() => '')}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
