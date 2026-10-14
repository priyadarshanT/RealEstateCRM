// Portal lead emails (SES receipt → SNS): who it was sent to, and the "Label: value" lines of the text part.

export interface LeadEmail {
  messageId: string;
  recipients: string[];
  from: string | null;
  subject: string | null;
  text: string;
  /** "Name: John" style lines as fields, plus the reply-to / sender address as a fallback email. */
  fields: Record<string, string>;
}

interface SesNotification {
  notificationType?: string;
  mail?: { messageId?: string; destination?: string[]; commonHeaders?: { from?: string[]; subject?: string; replyTo?: string[] } };
  receipt?: { recipients?: string[] };
  content?: string;
}

/** Reads the SES "Received" notification carried in an SNS message; undefined for anything else. */
export function readLeadEmail(snsMessage: string): LeadEmail | undefined {
  let n: SesNotification;
  try {
    n = JSON.parse(snsMessage) as SesNotification;
  } catch {
    return undefined;
  }
  if (n.notificationType !== 'Received' || !n.mail?.messageId) return undefined;
  const text = n.content ? textPart(n.content) : '';
  const fields: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][A-Za-z0-9 _/().-]{0,40}?)\s*[:：]\s*(.+?)\s*$/.exec(line);
    const label = m?.[1]!.trim();
    if (m && label && !(label in fields)) fields[label] = m[2]!;
  }
  const replyTo = n.mail.commonHeaders?.replyTo?.[0];
  if (replyTo && !Object.keys(fields).some((k) => /e-?mail/i.test(k))) fields.email = address(replyTo);
  return {
    messageId: n.mail.messageId,
    recipients: (n.receipt?.recipients ?? n.mail.destination ?? []).map((r) => address(r).toLowerCase()),
    from: n.mail.commonHeaders?.from?.[0] ?? null,
    subject: n.mail.commonHeaders?.subject ?? null,
    text: text.slice(0, 20_000),
    fields,
  };
}

/** The plain-text body of a MIME message (first text/plain part, else text/html without tags). */
function textPart(raw: string): string {
  const { headers, body } = split(raw);
  const type = headers['content-type'] ?? 'text/plain';
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
  if (/^multipart\//i.test(type) && boundary) {
    const parts = body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith('--'));
    const decoded = parts.map((p) => {
      const part = split(p.replace(/^\r?\n/, ''));
      const partType = part.headers['content-type'] ?? 'text/plain';
      return { partType, text: /^multipart\//i.test(partType) ? textPart(p.replace(/^\r?\n/, '')) : decode(part.body, part.headers['content-transfer-encoding']) };
    });
    const plain = decoded.find((d) => /^(text\/plain|multipart\/)/i.test(d.partType) && d.text.trim());
    if (plain) return plain.text;
    const html = decoded.find((d) => /^text\/html/i.test(d.partType));
    return html ? stripHtml(html.text) : '';
  }
  const text = decode(body, headers['content-transfer-encoding']);
  return /^text\/html/i.test(type) ? stripHtml(text) : text;
}

function split(raw: string): { headers: Record<string, string>; body: string } {
  const at = raw.search(/\r?\n\r?\n/);
  const head = at < 0 ? raw : raw.slice(0, at);
  const body = at < 0 ? '' : raw.slice(at).replace(/^\r?\n\r?\n/, '');
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { headers, body };
}

function decode(body: string, encoding = ''): string {
  if (/base64/i.test(encoding)) return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
  if (/quoted-printable/i.test(encoding)) {
    const bytes = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(bytes, 'latin1').toString('utf8');
  }
  return body;
}

function stripHtml(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/tr|\/li)[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ': ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/:\s*:\s*/g, ': ');
}

function address(value: string): string {
  return /<([^>]+)>/.exec(value)?.[1]?.trim() ?? value.trim();
}
