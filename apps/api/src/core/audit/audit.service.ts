import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, SQL } from 'drizzle-orm';
import { DbService } from '../database/db.service';
import { RequestContext } from '../http/request-context';
import { decodeCursor, Page, toPage } from '../http/pagination';
import { auditLogs } from './audit.schema';
import { dayStart, dayAfter } from '../http/dates';

// Actions allowed by the audit_logs.action check constraint.
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'merge'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'export'
  | 'approve'
  | 'cancel'
  | 'permission_change'
  | 'setting_change';

/** Field changes as {"field": [old, new]}. */
export type AuditChanges = Record<string, [unknown, unknown]>;

export interface AuditEntry {
  id: number;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditFilter {
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit: number;
}

/** Shared audit log writer (SRS §14): every module records its changes here, in the same transaction. */
@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  /** `actorUserId` overrides the signed-in user, e.g. while the login itself is being recorded. */
  async record(
    action: AuditAction,
    entityType: string,
    entityId: string | null,
    changes?: AuditChanges | null,
    actorUserId?: string,
  ): Promise<void> {
    const tenantId = this.db.currentTenantId;
    if (!tenantId) throw new Error('Audit entries are written inside a tenant transaction');
    const ctx = RequestContext.get();
    await this.db.current.insert(auditLogs).values({
      tenantId,
      userId: actorUserId ?? ctx.userId ?? null,
      action,
      entityType,
      entityId,
      changes: changes && Object.keys(changes).length ? changes : null,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId ?? null,
    });
  }

  /** Records only the fields whose value changed. Returns false when nothing changed. */
  async recordUpdate<T extends object>(entityType: string, entityId: string, before: T, after: T, action: AuditAction = 'update'): Promise<boolean> {
    const changes = diff(before, after);
    if (!Object.keys(changes).length) return false;
    await this.record(action, entityType, entityId, changes);
    return true;
  }

  async list(filter: AuditFilter): Promise<Page<AuditEntry>> {
    const where: (SQL | undefined)[] = [
      filter.entityType ? eq(auditLogs.entityType, filter.entityType) : undefined,
      filter.entityId ? eq(auditLogs.entityId, filter.entityId) : undefined,
      filter.userId ? eq(auditLogs.userId, filter.userId) : undefined,
      filter.action ? eq(auditLogs.action, filter.action) : undefined,
      filter.from ? gte(auditLogs.createdAt, dayStart(filter.from)) : undefined,
      filter.to ? lt(auditLogs.createdAt, dayAfter(filter.to)) : undefined,
    ];
    if (filter.cursor) where.push(lt(auditLogs.id, Number(decodeCursor(filter.cursor, 1)[0])));
    const rows = await this.db.current
      .select()
      .from(auditLogs)
      .where(and(...where))
      .orderBy(desc(auditLogs.id))
      .limit(filter.limit + 1);
    return toPage(rows, filter.limit, (r) => [r.id], (r) => ({
      id: r.id,
      userId: r.userId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      changes: r.changes ?? null,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

function diff<T extends object>(before: T, after: T): AuditChanges {
  const changes: AuditChanges = {};
  for (const key of Object.keys(after) as (keyof T & string)[]) {
    const [a, b] = [before[key], after[key]];
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[key] = [a ?? null, b ?? null];
  }
  return changes;
}
