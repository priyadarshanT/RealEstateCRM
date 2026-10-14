import { Logger } from '@nestjs/common';
import { createVerify } from 'node:crypto';

/** An Amazon SNS HTTP(S) message (notification or subscription confirmation). */
export interface SnsMessage {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation' | string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
  SignatureVersion?: string;
  Signature?: string;
  SigningCertURL?: string;
}

/**
 * Adapter for Amazon SNS (portal lead emails arrive SES → SNS → /webhooks/email-inbound). Live: the signature is
 * checked with Amazon's certificate and subscriptions are confirmed. Locally (MESSAGING_MODE=simulate) messages
 * are accepted as sent, so lead emails can be tried without AWS.
 */
export interface SnsVerifier {
  verify(message: SnsMessage): Promise<boolean>;
  confirmSubscription(message: SnsMessage): Promise<void>;
}
export const SNS_VERIFIER = Symbol('SNS_VERIFIER');

const CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

export class LiveSnsVerifier implements SnsVerifier {
  private readonly certs = new Map<string, string>();

  async verify(m: SnsMessage): Promise<boolean> {
    if (!m.Signature || !m.SigningCertURL) return false;
    const url = new URL(m.SigningCertURL);
    if (url.protocol !== 'https:' || !CERT_HOST.test(url.hostname) || !url.pathname.endsWith('.pem')) return false;
    let cert = this.certs.get(url.href);
    if (!cert) {
      const res = await fetch(url.href);
      if (!res.ok) return false;
      cert = await res.text();
      this.certs.set(url.href, cert);
    }
    const verifier = createVerify(m.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1');
    verifier.update(stringToSign(m));
    return verifier.verify(cert, m.Signature, 'base64');
  }

  async confirmSubscription(m: SnsMessage): Promise<void> {
    if (!m.SubscribeURL) return;
    const url = new URL(m.SubscribeURL);
    if (url.protocol !== 'https:' || !CERT_HOST.test(url.hostname)) throw new Error('Unexpected SubscribeURL host');
    const res = await fetch(url.href);
    if (!res.ok) throw new Error(`SNS subscription confirmation failed: ${res.status}`);
  }
}

export class SimulatedSnsVerifier implements SnsVerifier {
  private readonly logger = new Logger('SnsVerifier');

  async verify(): Promise<boolean> {
    return true;
  }

  async confirmSubscription(m: SnsMessage): Promise<void> {
    this.logger.log(`[simulated] SNS subscription to ${m.TopicArn} confirmed`);
  }
}

/** The canonical text SNS signs: selected keys in order, each "Key\nValue\n". */
function stringToSign(m: SnsMessage): string {
  const keys = m.Type === 'Notification' ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'] : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return keys
    .filter((k) => (m as unknown as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${k}\n${(m as unknown as Record<string, string>)[k]}\n`)
    .join('');
}
