import { Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, Matches } from 'class-validator';
import { and, eq, sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { DbService } from '../../core/database/db.service';
import { Problems } from '../../core/errors/problem';

// user_list_columns (migration 0008): Manage Columns, saved per user and list.
export const userListColumns = pgTable('user_list_columns', {
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  listKey: text('list_key').notNull(),
  columns: text('columns').array().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const LIST_KEYS = ['leads', 'projects'] as const;
export type ListKey = (typeof LIST_KEYS)[number];

export class ListColumnsDto {
  @ApiProperty({ type: [String], nullable: true, description: 'Column keys in display order; empty = the default columns' }) columns!: string[] | null;
}

export class SaveListColumnsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ArrayUnique()
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/, { each: true })
  columns!: string[];
}

/** Manage Columns: which columns a user shows on the Lead or Project list, in their order (Apply / Reset). */
@Injectable()
export class ListColumnsService {
  constructor(private readonly db: DbService) {}

  async get(userId: string, list: string): Promise<ListColumnsDto> {
    const key = checkList(list);
    const [row] = await this.db.current
      .select({ columns: userListColumns.columns })
      .from(userListColumns)
      .where(and(eq(userListColumns.userId, userId), eq(userListColumns.listKey, key)))
      .limit(1);
    return { columns: row?.columns ?? null };
  }

  async save(userId: string, list: string, columns: string[]): Promise<ListColumnsDto> {
    const key = checkList(list);
    await this.db.current
      .insert(userListColumns)
      .values({ tenantId: this.db.currentTenantId!, userId, listKey: key, columns })
      .onConflictDoUpdate({ target: [userListColumns.tenantId, userListColumns.userId, userListColumns.listKey], set: { columns, updatedAt: sql`now()` } });
    return { columns };
  }

  /** Reset to Default: the saved choice is removed. */
  async reset(userId: string, list: string): Promise<void> {
    const key = checkList(list);
    await this.db.current.delete(userListColumns).where(and(eq(userListColumns.userId, userId), eq(userListColumns.listKey, key)));
  }
}

function checkList(list: string): ListKey {
  if (!(LIST_KEYS as readonly string[]).includes(list)) throw Problems.notFound();
  return list as ListKey;
}
