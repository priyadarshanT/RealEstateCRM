'use client';

import { Alert, Button, Field, Input, Select, Textarea, cn } from '@crm/ui';
import { Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { CHANNEL_LABEL, fill, placeholders, useSendMessage, useTemplates, type Channel } from './messaging-api';

/**
 * Write a WhatsApp or email message, or send an approved template (SRS §5.1–5.2). WhatsApp free text is only
 * allowed within 24 hours of the lead's last message; otherwise WhatsApp requires an approved template.
 */
export function Composer({
  leadId,
  channel,
  replyWindowOpen,
  compact,
  onSent,
}: {
  leadId: string;
  channel: Channel;
  /** WhatsApp only: the lead wrote in the last 24 hours. */
  replyWindowOpen: boolean;
  compact?: boolean;
  onSent?: () => void;
}) {
  const templates = useTemplates({ channel, status: 'approved' });
  const send = useSendMessage(leadId);
  const freeTextAllowed = channel === 'email' || replyWindowOpen;
  const [mode, setMode] = useState<'text' | 'template'>(freeTextAllowed ? 'text' : 'template');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!freeTextAllowed) setMode('template');
  }, [freeTextAllowed]);

  const template = templates.data?.find((t) => t.id === templateId);
  const names = useMemo(() => [...new Set([...placeholders(template?.subject), ...placeholders(template?.body)])], [template]);
  const ready = mode === 'template' ? !!template && names.every((n) => values[n]?.trim()) : !!body.trim() && (channel !== 'email' || !!subject.trim());

  async function submit() {
    const payload =
      mode === 'template'
        ? { channel, templateId, variables: values }
        : { channel, body: body.trim(), ...(channel === 'email' ? { subject: subject.trim() } : {}) };
    const ok = await send.mutateAsync(payload).catch(() => null);
    if (ok) {
      setBody('');
      setSubject('');
      setValues({});
      setTemplateId('');
      onSent?.();
    }
  }

  const err = send.error instanceof ApiError ? send.error : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 text-xs">
        <button
          type="button"
          disabled={!freeTextAllowed}
          onClick={() => setMode('text')}
          className={cn('rounded-full px-2.5 py-1', mode === 'text' ? 'bg-primary text-primary-foreground' : 'bg-muted', !freeTextAllowed && 'opacity-50')}
        >
          Write
        </button>
        <button type="button" onClick={() => setMode('template')} className={cn('rounded-full px-2.5 py-1', mode === 'template' ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
          Template
        </button>
        {!freeTextAllowed ? <span className="ml-1 text-muted-foreground">No reply from the lead in 24 hours: WhatsApp needs an approved template.</span> : null}
      </div>

      {mode === 'text' ? (
        <>
          {channel === 'email' ? <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" /> : null}
          <Textarea
            className={compact ? 'min-h-16' : 'min-h-24'}
            placeholder={`Type a ${CHANNEL_LABEL[channel]} message…`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label="Message"
          />
        </>
      ) : (
        <div className="space-y-2">
          <Select value={templateId} onChange={(e) => (setTemplateId(e.target.value), setValues({}))} aria-label="Template">
            <option value="">{templates.data?.length ? 'Choose an approved template' : 'No approved templates yet (Settings → Templates)'}</option>
            {templates.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.language}
              </option>
            ))}
          </Select>
          {names.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {names.map((n) => (
                <Field key={n} label={n.replaceAll('_', ' ')}>
                  <Input
                    value={values[n] ?? ''}
                    placeholder={template?.variables?.find((v) => v.name === n)?.example}
                    onChange={(e) => setValues((v) => ({ ...v, [n]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>
          ) : null}
          {template ? (
            <div className="rounded-md bg-muted/70 p-2 text-sm whitespace-pre-wrap">
              {template.subject ? <p className="font-medium">{fill(template.subject, values)}</p> : null}
              {fill(template.body, values)}
            </div>
          ) : null}
        </div>
      )}

      {err?.problem.code === 'OPTED_OUT' ? <Alert>This lead opted out of {CHANNEL_LABEL[channel]}. Messages are not sent.</Alert> : send.error ? <Alert>{errorMessage(send.error)}</Alert> : null}
      <div className="flex justify-end">
        <Button size="sm" disabled={!ready || send.isPending} onClick={submit}>
          <Send /> {send.isPending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
