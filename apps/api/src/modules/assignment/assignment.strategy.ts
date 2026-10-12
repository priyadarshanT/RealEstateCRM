import { UserSummary } from '../organization/directory.service';

/** Chooses the next owner from a pool of available agents (architecture: strategy pattern for assignment). */
export interface AssignmentStrategy {
  pick(pool: UserSummary[], lastAssignedUserId: string | null): UserSummary | undefined;
}

/** Round-robin: the agent after the last one assigned, in a stable order; wraps around. */
export class RoundRobinStrategy implements AssignmentStrategy {
  pick(pool: UserSummary[], lastAssignedUserId: string | null): UserSummary | undefined {
    if (!pool.length) return undefined;
    const ordered = [...pool].sort((a, b) => a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id));
    const last = lastAssignedUserId ? ordered.findIndex((u) => u.id === lastAssignedUserId) : -1;
    if (last >= 0) return ordered[(last + 1) % ordered.length];
    if (!lastAssignedUserId) return ordered[0];
    // The last agent left the pool: continue after where they would have been.
    const lastUser = pool.find((u) => u.id === lastAssignedUserId);
    return ordered.find((u) => lastUser && u.fullName.localeCompare(lastUser.fullName) > 0) ?? ordered[0];
  }
}

/** An agent can receive new leads: active and lead assignment switched on (SRS §4.2, §4.8). */
export function isAvailable(u: UserSummary): boolean {
  return u.status === 'active' && u.receivesLeads;
}
