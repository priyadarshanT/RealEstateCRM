import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { DbService } from '../../core/database/db.service';
import { EventBus } from '../../core/events/domain-events';
import { decodeCursor, encodeCursor, Page } from '../../core/http/pagination';
import { RequestContext } from '../../core/http/request-context';
import { OrganizationDirectory } from '../organization/directory.service';

// notifications and push_devices (db/schema.sql), owned by this module.
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  leadId: uuid('lead_id'),
  linkPath: text('link_path'),
  pushSentAt: timestamp('push_sent_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pushDevices = pgTable('push_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  fcmToken: text('fcm_token').notNull(),
  platform: text('platform').$type<'android' | 'ios' | 'web'>().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  leadId: string | null;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  leadId?: string | null;
}

/**
 * In-app notifications (SRS §3.3, §2.6, §3.7; architecture "notifications"). Reacts to domain events; other
 * modules can also call notify(). Push to phones (Firebase) is sent from the stored notification once connected.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly events: EventBus,
    private readonly directory: OrganizationDirectory,
  ) {}

  onModuleInit(): void {
    this.events.on('lead.assigned', async (e) => {
      const actor = RequestContext.get().userId;
      if (e.method === 'no_response' || e.method === 'admin_fallback') {
        if (e.fromUserId) {
          await this.notify({ userId: e.fromUserId, type: 'lead_no_response', title: 'Lead moved: no response', body: 'You did not act on this lead in time, so it moved on.', leadId: e.leadId });
        }
      }
      if (!e.toUserId || e.toUserId === actor) return;
      if (e.method === 'admin_fallback') {
        await this.notify({ userId: e.toUserId, type: 'lead_admin_fallback', title: 'Lead returned to you', body: 'Every agent in the team missed this lead. See the timeline for who missed it and when.', leadId: e.leadId });
      } else {
        await this.notify({ userId: e.toUserId, type: 'lead_assigned', title: 'New lead assigned to you', leadId: e.leadId });
      }
    });
    this.events.on('lead.re_enquired', async (e) => {
      if (e.ownerUserId) await this.notify({ userId: e.ownerUserId, type: 'lead_re_enquired', title: `Re-enquired via ${e.sourceName}`, leadId: e.leadId });
    });
    this.events.on('lead.shared', async (e) => {
      const by = await this.directory.user(e.sharedBy);
      await this.notify({ userId: e.userId, type: 'lead_shared', title: `${by?.fullName ?? 'A colleague'} shared a lead with you`, body: e.access === 'edit' ? 'You can edit it.' : 'View only.', leadId: e.leadId });
    });
  }

  async notify(input: NotifyInput): Promise<void> {
    await this.db.current.insert(notifications).values({
      tenantId: this.db.currentTenantId!,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      leadId: input.leadId ?? null,
      linkPath: input.leadId ? `/leads/${input.leadId}` : null,
    });
  }

  async list(userId: string, limit: number, cursor?: string, unread?: boolean): Promise<Page<NotificationDto>> {
    let after;
    if (cursor) {
      const [at, id] = decodeCursor(cursor, 2) as [string, string];
      after = or(lt(notifications.createdAt, new Date(at)), and(eq(notifications.createdAt, new Date(at)), sql`${notifications.id} < ${id}::uuid`));
    }
    const rows = await this.db.current
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), unread ? isNull(notifications.readAt) : undefined, after))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const kept = rows.slice(0, limit);
    const last = kept[kept.length - 1];
    return {
      data: kept.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        leadId: n.leadId,
        linkPath: n.linkPath,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      page: { nextCursor: hasMore && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null, hasMore },
    };
  }

  async markRead(userId: string, id: string): Promise<boolean> {
    const rows = await this.db.current
      .update(notifications)
      .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning({ id: notifications.id });
    return rows.length > 0;
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db.current.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }

  async registerDevice(userId: string, fcmToken: string, platform: 'android' | 'ios' | 'web'): Promise<void> {
    await this.db.current
      .insert(pushDevices)
      .values({ tenantId: this.db.currentTenantId!, userId, fcmToken, platform })
      .onConflictDoUpdate({ target: pushDevices.fcmToken, set: { userId, platform, tenantId: this.db.currentTenantId!, lastSeenAt: new Date() } });
  }

  async removeDevice(userId: string, fcmToken: string): Promise<boolean> {
    const rows = await this.db.current
      .delete(pushDevices)
      .where(and(eq(pushDevices.fcmToken, fcmToken), eq(pushDevices.userId, userId)))
      .returning({ id: pushDevices.id });
    return rows.length > 0;
  }
}
