'use client';

import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, DialogContent, Field, Select, Textarea } from '@crm/ui';
import { useState } from 'react';
import { errorMessage } from '@/core/api';
import { formatDateTime } from '@/core/format';
import { latestConsent, useConsents, useRecordConsent, type Consent } from './messaging-api';

const CHANNELS: { key: Consent['channel']; label: string }[] = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
];

/** Consent and opt-out per channel (SRS §5.6). Each change is a new record; the latest one counts. */
export function ConsentCard({ leadId, canEdit, timeZone }: { leadId: string; canEdit: boolean; timeZone?: string }) {
  const history = useConsents(leadId);
  const record = useRecordConsent(leadId);
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<Consent['channel']>('whatsapp');
  const [status, setStatus] = useState<Consent['status']>('opted_out');
  const [method, setMethod] = useState<Consent['captureMethod']>('manual');
  const [note, setNote] = useState('');

  return (
    <Card>
      <CardHeader
        title="Consent"
        actions={
          canEdit ? (
            <Button variant="link" size="sm" onClick={() => setOpen(true)}>
              Record
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-1.5">
        {CHANNELS.map((c) => {
          const latest = latestConsent(history.data, c.key);
          return (
            <div key={c.key} className="flex items-center justify-between text-sm">
              <span>{c.label}</span>
              {latest ? (
                <span className="flex items-center gap-1.5">
                  <Badge tone={latest.status === 'opted_out' ? 'danger' : 'success'}>{latest.status === 'opted_out' ? 'Opted out' : 'Opted in'}</Badge>
                  <span className="text-xs text-muted-foreground">{formatDateTime(latest.recordedAt, timeZone)}</span>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Not recorded</span>
              )}
            </div>
          );
        })}
      </CardBody>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Record consent">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await record.mutateAsync({ channel, status, captureMethod: method, note: note.trim() || null }).catch(() => null);
              if (ok) {
                setNote('');
                setOpen(false);
              }
            }}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Channel">
                <Select value={channel} onChange={(e) => setChannel(e.target.value as Consent['channel'])}>
                  {CHANNELS.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status">
                <Select value={status} onChange={(e) => setStatus(e.target.value as Consent['status'])}>
                  <option value="opted_out">Opted out</option>
                  <option value="opted_in">Opted in</option>
                </Select>
              </Field>
              <Field label="How">
                <Select value={method} onChange={(e) => setMethod(e.target.value as Consent['captureMethod'])}>
                  <option value="manual">Told us directly</option>
                  <option value="form">Form</option>
                  <option value="reply">Message reply</option>
                  <option value="unsubscribe_link">Unsubscribe link</option>
                  <option value="import">Import</option>
                </Select>
              </Field>
            </div>
            <Field label="Note (evidence)">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Asked on the phone not to receive WhatsApp" />
            </Field>
            {record.error ? <Alert>{errorMessage(record.error)}</Alert> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={record.isPending}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
