/**
 * What the organization module needs from the leads module (SRS §4.3: a user's leads must be reassigned
 * before the user is deactivated). Implemented by the leads module; until it exists the check is skipped.
 */
export interface UserLeadsPort {
  countOpenLeads(userId: string): Promise<number>;
  reassignOpenLeads(fromUserId: string, toUserId: string): Promise<void>;
}
export const USER_LEADS_PORT = Symbol('USER_LEADS_PORT');
