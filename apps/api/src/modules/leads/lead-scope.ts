import { Injectable } from '@nestjs/common';
import { AnyColumn, and, eq, inArray, or, sql, SQL } from 'drizzle-orm';
import { Principal } from '../../core/auth/principal';
import { DbService } from '../../core/database/db.service';
import { OrganizationDirectory } from '../organization/directory.service';
import { leadShares, leads, LeadRow } from './leads.schema';

/** How the current user reaches a lead (Lead.access in the contract). */
export type LeadAccess = 'owner' | 'scope' | 'edit' | 'view';

/**
 * Data scope (API guide §3): own = own leads plus leads shared with the user; team = the teams they lead or manage;
 * division = their divisions' teams; company = everything in the tenant. A lead outside the scope returns 404.
 */
@Injectable()
export class LeadScope {
  constructor(
    private readonly db: DbService,
    private readonly directory: OrganizationDirectory,
  ) {}

  /** SQL condition: leads the principal may see (row-level security already limits to the tenant). */
  async visible(p: Principal): Promise<SQL | undefined> {
    if (p.dataScope === 'company') return undefined;
    const shared = sql`EXISTS (SELECT 1 FROM ${leadShares} WHERE ${leadShares.leadId} = ${leads.id} AND ${leadShares.userId} = ${p.userId})`;
    const own = eq(leads.ownerUserId, p.userId);
    if (p.dataScope === 'own') return or(own, shared);
    const teamIds = await this.directory.scopeTeamIds(p.userId, p.dataScope);
    return teamIds.length ? or(own, shared, inArray(leads.teamId, teamIds)) : or(own, shared);
  }

  /**
   * For other modules that store a lead ID (conversations, meetings…): "column is a lead this principal may see",
   * as a subquery owned by the leads module, so callers never read the leads table themselves.
   */
  async visibleLeadIdIn(p: Principal, column: SQL | AnyColumn): Promise<SQL | undefined> {
    const cond = await this.visible(p);
    if (!cond) return undefined;
    return sql`${column} IN (SELECT ${leads.id} FROM ${leads} WHERE ${cond})`;
  }

  /** Leads within the principal's role scope only (not through shares): owner or a manager above them. */
  async managed(p: Principal): Promise<SQL | undefined> {
    if (p.dataScope === 'company') return undefined;
    const own = eq(leads.ownerUserId, p.userId);
    if (p.dataScope === 'own') return own;
    const teamIds = await this.directory.scopeTeamIds(p.userId, p.dataScope);
    return teamIds.length ? or(own, inArray(leads.teamId, teamIds)) : own;
  }

  /** The principal's access to each lead (undefined = not visible). */
  async accessFor(p: Principal, rows: Pick<LeadRow, 'id' | 'ownerUserId' | 'teamId'>[]): Promise<Map<string, LeadAccess>> {
    const result = new Map<string, LeadAccess>();
    if (!rows.length) return result;
    const teamIds = p.dataScope === 'team' || p.dataScope === 'division' ? new Set(await this.directory.scopeTeamIds(p.userId, p.dataScope)) : new Set<string>();
    const shares = await this.db.current
      .select({ leadId: leadShares.leadId, access: leadShares.access })
      .from(leadShares)
      .where(and(eq(leadShares.userId, p.userId), inArray(leadShares.leadId, rows.map((r) => r.id))));
    const shareOf = new Map(shares.map((s) => [s.leadId, s.access]));
    for (const row of rows) {
      if (row.ownerUserId === p.userId) result.set(row.id, 'owner');
      else if (p.dataScope === 'company' || (row.teamId && teamIds.has(row.teamId))) result.set(row.id, 'scope');
      else if (shareOf.has(row.id)) result.set(row.id, shareOf.get(row.id)!);
    }
    return result;
  }
}

/** Owner or manager above them (needed to reassign, delete, restore or share). */
export const canManage = (a: LeadAccess | undefined): boolean => a === 'owner' || a === 'scope';
/** Owner, manager, or shared with "Can edit". */
export const canEdit = (a: LeadAccess | undefined): boolean => a === 'owner' || a === 'scope' || a === 'edit';
