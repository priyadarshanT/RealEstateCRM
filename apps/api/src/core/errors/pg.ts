// PostgreSQL error helpers, unwrapping Drizzle's query error.
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';

export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
}

export function pgMessage(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string } };
  return e.cause?.message ?? e.message ?? '';
}

/** A delete or update blocked because other rows still reference this one (vs. a link to a missing row). */
export function isStillReferenced(err: unknown): boolean {
  return pgCode(err) === PG_FOREIGN_KEY_VIOLATION && /update or delete on table/.test(pgMessage(err));
}
