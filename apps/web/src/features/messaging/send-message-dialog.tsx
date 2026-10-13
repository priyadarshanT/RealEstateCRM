'use client';

import { Alert, Dialog, DialogContent } from '@crm/ui';
import { Composer } from './composer';
import { CHANNEL_LABEL, latestConsent, useConsents, useConversations, type Channel } from './messaging-api';

/** Send WhatsApp or email from the lead page (wireframe "Lead page": WhatsApp and Email buttons). */
export function SendMessageDialog({
  leadId,
  leadName,
  channel,
  address,
  onClose,
}: {
  leadId: string;
  leadName: string;
  channel: Channel | null;
  address: string | null | undefined;
  onClose: () => void;
}) {
  const conversation = useConversations(channel ? { leadId, channel } : { leadId });
  const consents = useConsents(leadId);
  if (!channel) return null;
  const thread = conversation.data?.find((c) => c.channel === channel);
  const optedOut = latestConsent(consents.data, channel)?.status === 'opted_out';

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={`${CHANNEL_LABEL[channel]} · ${leadName}`}>
        {!address ? (
          <Alert>{channel === 'whatsapp' ? 'This lead has no phone number.' : 'This lead has no email address.'} Add one with Edit lead first.</Alert>
        ) : optedOut ? (
          <Alert>This lead opted out of {CHANNEL_LABEL[channel]}. Messages are not sent.</Alert>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">To {address}</p>
            <Composer leadId={leadId} channel={channel} replyWindowOpen={thread?.replyWindowOpen ?? false} onSent={onClose} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
