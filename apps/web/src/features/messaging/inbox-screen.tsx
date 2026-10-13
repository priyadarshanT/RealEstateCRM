'use client';

import { Alert, Badge, EmptyState, Loading, Select, cn } from '@crm/ui';
import { Mail, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/core/api';
import { formatRelativeDay } from '@/core/format';
import { useMe } from '@/core/session';
import { Composer } from './composer';
import { MessageBubble } from './message-bubble';
import { CHANNEL_LABEL, useConversations, useLeadNames, useMarkRead, useMessages, type Channel, type Conversation } from './messaging-api';

/** WhatsApp & Email (wireframe): conversations with each lead on the left, the thread and reply box on the right. */
export function InboxScreen() {
  const me = useMe();
  const tz = me.data?.user.timezone;
  const [channel, setChannel] = useState<Channel | ''>('');
  const [unread, setUnread] = useState(false);
  const list = useConversations({ ...(channel ? { channel } : {}), ...(unread ? { unread: true } : {}) });
  const names = useLeadNames((list.data ?? []).map((c) => c.leadId));
  const [openId, setOpenId] = useState<string | null>(null);
  const open = list.data?.find((c) => c.id === openId) ?? null;
  const markRead = useMarkRead();

  useEffect(() => {
    if (!openId && list.data?.[0]) setOpenId(list.data[0].id);
  }, [list.data, openId]);
  useEffect(() => {
    if (open && open.unreadCount > 0) markRead.mutate(open.id);
    // Only when another conversation is opened.
  }, [open?.id]);

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">WhatsApp & Email</h1>
      <div className="flex flex-wrap items-center gap-2">
        <Select className="h-8 w-auto text-xs" value={channel} onChange={(e) => setChannel(e.target.value as Channel | '')} aria-label="Channel">
          <option value="">All channels</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} /> Unread only
        </label>
      </div>
      {list.error ? <Alert>{errorMessage(list.error)}</Alert> : null}
      <div className="grid min-h-[32rem] gap-3 lg:grid-cols-[18rem_1fr]">
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {list.isLoading ? <Loading /> : null}
          {list.data?.length === 0 ? (
            <EmptyState title="No conversations yet">Send a WhatsApp or email from a lead page to start one.</EmptyState>
          ) : null}
          {list.data?.map((c) => (
            <ConversationRow key={c.id} c={c} name={names.get(c.leadId)} active={c.id === openId} timeZone={tz} onOpen={() => setOpenId(c.id)} />
          ))}
        </div>
        {open ? <Thread conversation={open} leadName={names.get(open.leadId)} timeZone={tz} /> : <div className="rounded-lg border border-border bg-surface" />}
      </div>
    </div>
  );
}

function ConversationRow({ c, name, active, timeZone, onOpen }: { c: Conversation; name?: string; active: boolean; timeZone?: string; onOpen: () => void }) {
  const Icon = c.channel === 'whatsapp' ? MessageCircle : Mail;
  return (
    <button type="button" onClick={onOpen} className={cn('flex w-full items-start gap-2 border-b border-border px-3 py-2.5 text-left hover:bg-muted/60', active && 'bg-primary/10')}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', c.channel === 'whatsapp' ? 'text-emerald-600' : 'text-info')} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{name ?? 'Lead'}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {CHANNEL_LABEL[c.channel]} · {c.contactAddress}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <span className="text-[11px] text-muted-foreground">{formatRelativeDay(c.lastMessageAt, timeZone)}</span>
        {c.unreadCount ? <Badge tone="success">{c.unreadCount}</Badge> : null}
      </span>
    </button>
  );
}

function Thread({ conversation, leadName, timeZone }: { conversation: Conversation; leadName?: string; timeZone?: string }) {
  const messages = useMessages(conversation.id);
  const bottom = useRef<HTMLDivElement>(null);
  const ordered = [...(messages.data ?? [])].reverse();

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [ordered.length]);

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-[#efe9df]">
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <Link href={`/leads/${conversation.leadId}`} className="font-semibold hover:text-primary">
          {leadName ?? 'Lead'}
        </Link>
        <span className="text-sm text-muted-foreground">· {CHANNEL_LABEL[conversation.channel]}</span>
        {conversation.channel === 'whatsapp' ? (
          <Badge tone={conversation.replyWindowOpen ? 'success' : 'neutral'} className="ml-auto">
            {conversation.replyWindowOpen ? 'Reply window open' : 'Template only'}
          </Badge>
        ) : null}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3" style={{ maxHeight: '28rem' }}>
        {messages.isLoading ? <Loading /> : null}
        {ordered.map((m) => (
          <MessageBubble key={m.id} message={m} timeZone={timeZone} />
        ))}
        <div ref={bottom} />
      </div>
      <div className="border-t border-border bg-surface p-3">
        <Composer leadId={conversation.leadId} channel={conversation.channel} replyWindowOpen={conversation.replyWindowOpen ?? false} compact />
      </div>
    </div>
  );
}
