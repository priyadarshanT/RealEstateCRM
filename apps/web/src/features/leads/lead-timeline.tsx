'use client';

import { Card, CardBody, CardHeader, Loading } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { ArrowRightLeft, CalendarCheck, Download, FileText, Mail, MessageCircle, NotebookPen, Phone, RotateCw, Share2, Sparkles, UserCog, type LucideIcon } from 'lucide-react';
import { formatDateTime } from '@/core/format';
import { byId, useColleagues } from '@/core/lookups';
import { useTimeline } from './leads-api';

const ICONS: Partial<Record<Schemas['Activity']['type'], LucideIcon>> = {
  inquiry: Download,
  re_enquiry: RotateCw,
  note: NotebookPen,
  call: Phone,
  stage_change: ArrowRightLeft,
  owner_change: UserCog,
  share: Share2,
  whatsapp: MessageCircle,
  email: Mail,
  meeting: CalendarCheck,
  viewing: CalendarCheck,
  attachment: FileText,
};

/** One timeline of everything that happened to the lead (SRS §2.13). History cannot be edited. */
export function LeadTimeline({ leadId, timeZone }: { leadId: string; timeZone?: string }) {
  const timeline = useTimeline(leadId);
  const users = byId(useColleagues().data);

  return (
    <Card>
      <CardHeader title="Timeline" />
      <CardBody className="pt-2">
        {timeline.isLoading ? <Loading /> : null}
        {timeline.data?.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : null}
        <ol className="divide-y divide-border">
          {timeline.data?.map((a) => {
            const Icon = ICONS[a.type] ?? Sparkles;
            const actor = a.actorUserId ? (users.get(a.actorUserId)?.fullName ?? 'A user') : 'System';
            return (
              <li key={a.id} className={a.type === 'note' ? 'my-1 rounded-md bg-muted/60 px-2 py-2.5' : 'py-2.5'}>
                <div className="flex gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{a.summary}</p>
                    {a.body ? <p className="whitespace-pre-wrap text-sm">{a.body}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      {actor} · {formatDateTime(a.occurredAt, timeZone)}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </CardBody>
    </Card>
  );
}
