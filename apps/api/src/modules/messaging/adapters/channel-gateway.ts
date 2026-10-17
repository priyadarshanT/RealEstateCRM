import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/** The company's sending account as the gateway needs it (from integrations: settings + stored credentials). */
export interface SenderAccount {
  provider: 'whatsapp_cloud' | 'email_ses';
  settings: Record<string, unknown>;
  credentials: Record<string, string>;
}

export interface OutboundMessage {
  to: string;
  subject?: string | null;
  body?: string | null;
  /** Attachment as a short-lived download link (WhatsApp document; link in the email text). */
  media?: { url: string; fileName: string };
  /** WhatsApp template: provider name, language and the values for {{1}}, {{2}}… in order. */
  template?: { name: string; language: string; params: string[] };
}

export interface TemplateSubmission {
  name: string;
  language: string;
  category: string;
  body: string;
}

/**
 * One adapter per provider (architecture): WhatsApp Business Platform (Meta Cloud API) and Amazon SES.
 * Each call returns the provider's message ID, used to match delivery and read receipts from webhooks.
 */
export interface ChannelGateway {
  send(account: SenderAccount, message: OutboundMessage): Promise<{ providerMessageId: string }>;
  /** WhatsApp templates must be approved by Meta before use; returns the template ID and the review status. */
  submitTemplate(account: SenderAccount, template: TemplateSubmission): Promise<{ providerTemplateId: string; status: 'pending' | 'approved' }>;
}
export const CHANNEL_GATEWAY = Symbol('CHANNEL_GATEWAY');

/** Live sending: Meta Graph API for WhatsApp, SES for email. */
export class LiveChannelGateway implements ChannelGateway {
  private readonly ses: SESv2Client;

  constructor(
    private readonly graphVersion: string,
    sesRegion: string,
  ) {
    this.ses = new SESv2Client({ region: sesRegion });
  }

  async send(account: SenderAccount, message: OutboundMessage): Promise<{ providerMessageId: string }> {
    if (account.provider === 'email_ses') return this.sendEmail(account, message);
    const token = account.credentials.accessToken;
    if (!token) throw new Error('The WhatsApp access token is missing; connect WhatsApp again');
    const payload = message.template
      ? {
          messaging_product: 'whatsapp',
          to: message.to.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: message.template.name,
            language: { code: message.template.language },
            ...(message.template.params.length ? { components: [{ type: 'body', parameters: message.template.params.map((text) => ({ type: 'text', text })) }] } : {}),
          },
        }
      : message.media
        ? { messaging_product: 'whatsapp', to: message.to.replace(/^\+/, ''), type: 'document', document: { link: message.media.url, filename: message.media.fileName, ...(message.body ? { caption: message.body } : {}) } }
        : { messaging_product: 'whatsapp', to: message.to.replace(/^\+/, ''), type: 'text', text: { body: message.body ?? '' } };
    const res = await this.graph(`/${String(account.settings.phoneNumberId)}/messages`, token, payload);
    const id = (res as { messages?: { id: string }[] }).messages?.[0]?.id;
    if (!id) throw new Error('WhatsApp did not return a message ID');
    return { providerMessageId: id };
  }

  async submitTemplate(account: SenderAccount, template: TemplateSubmission): Promise<{ providerTemplateId: string; status: 'pending' | 'approved' }> {
    if (account.provider === 'email_ses') return { providerTemplateId: randomUUID(), status: 'approved' };
    const token = account.credentials.accessToken;
    if (!token) throw new Error('The WhatsApp access token is missing; connect WhatsApp again');
    const res = (await this.graph(`/${String(account.settings.wabaId)}/message_templates`, token, {
      name: template.name,
      language: template.language,
      category: template.category.toUpperCase(),
      components: [{ type: 'BODY', text: template.body }],
    })) as { id?: string; status?: string };
    if (!res.id) throw new Error('WhatsApp did not return a template ID');
    return { providerTemplateId: res.id, status: res.status === 'APPROVED' ? 'approved' : 'pending' };
  }

  private async sendEmail(account: SenderAccount, message: OutboundMessage): Promise<{ providerMessageId: string }> {
    const fromAddress = String(account.settings.fromAddress);
    const from = account.settings.fromName ? `${String(account.settings.fromName)} <${fromAddress}>` : fromAddress;
    const out = await this.ses.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [message.to] },
        ...(account.settings.replyTo ? { ReplyToAddresses: [String(account.settings.replyTo)] } : {}),
        Content: {
          Simple: {
            Subject: { Data: message.subject ?? '' },
            Body: { Text: { Data: emailText(account, message) } },
          },
        },
      }),
    );
    if (!out.MessageId) throw new Error('SES did not return a message ID');
    return { providerMessageId: out.MessageId };
  }

  private async graph(path: string, token: string, body: unknown): Promise<unknown> {
    const res = await fetch(`https://graph.facebook.com/${this.graphVersion}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
    if (!res.ok) throw new Error(`WhatsApp error ${json.error?.code ?? res.status}: ${json.error?.message ?? res.statusText}`);
    return json;
  }
}

/**
 * MESSAGING_MODE=simulate (local development and tests): nothing leaves the server. Messages get a fake provider
 * ID and are written to the log; templates are approved at once. A recipient containing "fail" fails, for tests.
 */
export class SimulatedChannelGateway implements ChannelGateway {
  private readonly logger = new Logger('Messaging');
  readonly sent: { account: SenderAccount; message: OutboundMessage }[] = [];

  async send(account: SenderAccount, message: OutboundMessage): Promise<{ providerMessageId: string }> {
    if (message.to.includes('fail')) throw new Error('Simulated provider error');
    this.sent.push({ account, message });
    const text = account.provider === 'email_ses' ? emailText(account, message) : (message.body ?? '');
    const what = message.template ? `template ${message.template.name} (${message.template.params.join(', ')})` : `${text.slice(0, 120)}${message.media ? ` [${message.media.fileName}]` : ''}`;
    this.logger.log(`[simulated ${account.provider}] to ${message.to}: ${what}`);
    return { providerMessageId: `sim_${randomUUID()}` };
  }

  async submitTemplate(): Promise<{ providerTemplateId: string; status: 'pending' | 'approved' }> {
    return { providerTemplateId: `sim_tpl_${randomUUID()}`, status: 'approved' };
  }
}

/** Email body: the text, the attachment link, then the sender's signature (Global Configuration › Email Configuration). */
export function emailText(account: SenderAccount, message: OutboundMessage): string {
  const raw = account.settings.signature;
  const signature = typeof raw === 'string' && raw.trim() ? `-- \n${raw.trim()}` : '';
  return [message.body ?? '', message.media ? `${message.media.fileName}: ${message.media.url}` : '', signature].filter(Boolean).join('\n\n');
}
