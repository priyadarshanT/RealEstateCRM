import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Problems } from '../errors/problem';

// Cursor paging (API guide §4): ?limit=50&cursor=… → { data, page: { nextCursor, hasMore } }

export class PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;
}

export class PageInfo {
  @ApiPropertyOptional({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}

export interface Page<T> {
  data: T[];
  page: PageInfo;
}

export function encodeCursor(values: unknown[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

export function decodeCursor(cursor: string, length: number): unknown[] {
  try {
    const values = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(values) && values.length === length) return values;
  } catch {
    // fall through
  }
  throw Problems.validation([{ field: 'cursor', message: 'cursor is invalid' }]);
}

/** Rows were fetched with limit + 1; trims the extra row and builds the next cursor from the last row kept. */
export function toPage<R, T>(rows: R[], limit: number, cursorOf: (row: R) => unknown[], map: (row: R) => T): Page<T> {
  const hasMore = rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  const last = kept[kept.length - 1];
  return { data: kept.map(map), page: { nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null, hasMore } };
}
