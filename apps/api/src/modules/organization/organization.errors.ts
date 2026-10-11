import { ProblemException } from '../../core/errors/problem';

// Business error codes from docs/05-API-Guide.md §6.
export const OrgErrors = {
  seatLimitReached: () =>
    new ProblemException(422, 'SEAT_LIMIT_REACHED', 'All seats are used', 'All paid seats are in use. Add a seat before activating another user.'),
  roleInUse: (users: number) =>
    new ProblemException(409, 'ROLE_IN_USE', 'Role in use', `${users} user(s) still have this role. Give them another role first.`),
  userHasOpenLeads: (leads: number) =>
    new ProblemException(422, 'USER_HAS_OPEN_LEADS', 'User has open leads', `This user owns ${leads} open lead(s). Reassign them first.`),
  emailTaken: () => new ProblemException(409, 'CONFLICT', 'Email already used', 'A user with this email already exists.'),
  roleKeyTaken: () => new ProblemException(409, 'CONFLICT', 'Role already exists', 'A role with this key already exists.'),
  nameTaken: (what: string) => new ProblemException(409, 'CONFLICT', `${what} already exists`, `A ${what.toLowerCase()} with this name already exists.`),
  inUse: (what: string) =>
    new ProblemException(409, 'CONFLICT', `${what} in use`, `This ${what.toLowerCase()} is still used by other records. Move them first.`),
  systemRole: (detail: string) => new ProblemException(403, 'FORBIDDEN', 'Built-in role', detail),
  invalidState: (detail: string) => new ProblemException(422, 'INVALID_STATE', 'Not allowed in the current state', detail),
};

/** PostgreSQL error code, unwrapped from Drizzle's query error. */
export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
}

/** The users_seat_limit trigger (security.sql) raises "Seat limit reached ..." when active users would exceed seats. */
export function isSeatLimit(err: unknown): boolean {
  const e = err as { message?: string; cause?: { message?: string } };
  return /Seat limit reached/.test(e.cause?.message ?? e.message ?? '');
}

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
