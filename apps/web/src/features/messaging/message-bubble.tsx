import { cn } from '@crm/ui';
import { Check, CheckCheck, Clock, TriangleAlert } from 'lucide-react';
import { formatDateTime } from '@/core/format';
import type { Message } from './messaging-api';

const STATUS_LABEL: Record<Message['status'], string> = {
  queued: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
  received: '',
};

/** One message in a thread: outbound on the right with delivery ticks, inbound on the left (wireframe). */
export function MessageBubble({ message, timeZone }: { message: Message; timeZone?: string }) {
  const out = message.direction === 'outbound';
  const Icon = message.status === 'read' || message.status === 'delivered' ? CheckCheck : message.status === 'sent' ? Check : message.status === 'failed' ? TriangleAlert : Clock;
  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm', out ? 'bg-emerald-100 text-emerald-950' : 'bg-surface', message.status === 'failed' && 'bg-danger/10')}>
        {message.subject ? <p className="font-semibold">{message.subject}</p> : null}
        {message.body ? <p className="whitespace-pre-wrap">{message.body}</p> : null}
        {message.mediaFileId ? <p className="text-xs italic">Attachment</p> : null}
        <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          {out ? (
            <>
              {STATUS_LABEL[message.status]} <Icon className={cn('size-3', message.status === 'read' && 'text-info')} /> ·
            </>
          ) : null}
          {formatDateTime(message.createdAt, timeZone)}
        </p>
        {message.status === 'failed' && message.errorMessage ? <p className="text-xs text-danger">{message.errorMessage}</p> : null}
      </div>
    </div>
  );
}
