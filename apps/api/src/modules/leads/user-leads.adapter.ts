import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DbService } from '../../core/database/db.service';
import { RequestContext } from '../../core/http/request-context';
import { UserLeadsPort } from '../organization/organization.ports';
import { leads } from './leads.schema';
import { LeadsService } from './leads.service';

/** The organization module's check before deactivating a user (SRS §4.3): open leads must be reassigned first. */
@Injectable()
export class UserLeadsAdapter implements UserLeadsPort {
  constructor(
    private readonly db: DbService,
    private readonly leads: LeadsService,
  ) {}

  async countOpenLeads(userId: string): Promise<number> {
    const [row] = await this.db.current
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(eq(leads.ownerUserId, userId), eq(leads.stageCategory, 'open'), isNull(leads.deletedAt)));
    return row?.n ?? 0;
  }

  async reassignOpenLeads(fromUserId: string, toUserId: string): Promise<void> {
    const rows = await this.db.current
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.ownerUserId, fromUserId), eq(leads.stageCategory, 'open'), isNull(leads.deletedAt)));
    for (const { id } of rows) {
      await this.leads.changeOwner(id, toUserId, { method: 'user_deactivated', actorUserId: RequestContext.get().userId ?? null });
    }
  }
}
