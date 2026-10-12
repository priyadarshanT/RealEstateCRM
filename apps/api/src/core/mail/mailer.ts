import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** System email (Amazon SES in AWS; architecture "SES: send email"). */
export interface Mailer {
  send(mail: Mail): Promise<void>;
}
export const MAILER = Symbol('MAILER');

export class SesMailer implements Mailer {
  private readonly ses: SESv2Client;

  constructor(
    region: string,
    private readonly from: string,
  ) {
    this.ses = new SESv2Client({ region });
  }

  async send(mail: Mail): Promise<void> {
    await this.ses.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [mail.to] },
        Content: { Simple: { Subject: { Data: mail.subject }, Body: { Text: { Data: mail.text } } } },
      }),
    );
  }
}

/** Local development: emails are written to the server log instead of being sent. */
@Injectable()
export class LogMailer implements Mailer {
  private readonly logger = new Logger('Mail');
  async send(mail: Mail): Promise<void> {
    this.logger.log(`to ${mail.to} | ${mail.subject}\n${mail.text}`);
  }
}

/** Tests: keeps the emails so a test can read, for example, the sign-up code. */
export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
  }
  last(to: string): Mail | undefined {
    return [...this.sent].reverse().find((m) => m.to.toLowerCase() === to.toLowerCase());
  }
}

@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Mailer => (config.MAIL_MODE === 'ses' ? new SesMailer(config.S3_REGION, config.MAIL_FROM) : new LogMailer()),
    },
  ],
  exports: [MAILER],
})
export class MailModule {}

