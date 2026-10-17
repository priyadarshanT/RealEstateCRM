import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../core/events/domain-events';
import { NotificationsService } from '../notifications/notifications.service';
import { LeadsService } from './leads.service';

/**
 * Enable Secondary Owner Notification (Global Configuration › Leads, needs Dual Lead Ownership): the secondary
 * owner hears when they are added, when the status or owner changes and when the lead enquires again.
 */
@Injectable()
export class SecondaryOwnerNotifier implements OnModuleInit {
  constructor(
    private readonly leads: LeadsService,
    private readonly notifications: NotificationsService,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.on('lead.secondary_owner_changed', async (e) => {
      if (e.userId && e.userId !== e.changedBy) await this.tell(e.leadId, 'You are now the secondary owner', 'A lead was shared with you as secondary owner.', e.userId);
    });
    this.events.on('lead.stage_changed', (e) => this.tell(e.leadId, 'Lead status changed', 'The status of a lead you co-own changed.'));
    this.events.on('lead.assigned', (e) => this.tell(e.leadId, 'Lead owner changed', 'A lead you co-own has a new owner.'));
    this.events.on('lead.re_enquired', (e) => this.tell(e.leadId, 'Lead enquired again', `A lead you co-own enquired again via ${e.sourceName}.`));
  }

  private async tell(leadId: string, title: string, body: string, userId?: string): Promise<void> {
    const features = await this.leads.features();
    if (!features.dual_ownership || !features.secondary_owner_notification) return;
    const to = userId ?? (await this.leads.findRow(leadId))?.secondaryOwnerUserId;
    if (!to) return;
    await this.notifications.notify({ userId: to, type: 'lead_secondary_owner', title, body, leadId });
  }
}
