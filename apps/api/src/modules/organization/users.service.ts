import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventBus } from '../../core/events/domain-events';
import { AuditService } from '../../core/audit/audit.service';
import { DbService } from '../../core/database/db.service';
import { Problems } from '../../core/errors/problem';
import { versionConflict } from '../../core/http/etag';
import { Page, toPage } from '../../core/http/pagination';
import { CreateUserDto, DeactivateUserDto, UpdateUserDto, UserDto, UserListQuery } from './dto/user.dto';
import { isSeatLimit, OrgErrors, pgCode, PG_UNIQUE_VIOLATION } from './organization.errors';
import { USER_LEADS_PORT, UserLeadsPort } from './organization.ports';
import { UserRow } from './organization.schema';
import { userCursor, UserPatch, UsersRepository } from './repositories/users.repository';

const EDITABLE = ['email', 'fullName', 'phone', 'roleId', 'teamId', 'languages', 'location', 'timezone'] as const;
const AUDITED = [...EDITABLE, 'status', 'receivesLeads'] as const;

/** Team menu → Manage users (SRS §4.1–4.3, §12 Seats). */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
    private readonly db: DbService,
    private readonly events: EventBus,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Provided by the leads module (resolved lazily: leads depends on organization, not the other way round). */
  private get leads(): UserLeadsPort | undefined {
    try {
      return this.moduleRef.get<UserLeadsPort>(USER_LEADS_PORT, { strict: false });
    } catch {
      return undefined;
    }
  }

  async list(query: UserListQuery): Promise<Page<UserDto>> {
    const rows = await this.users.list(query);
    return toPage(rows, query.limit, userCursor, UserDto.from);
  }

  async get(id: string): Promise<UserRow> {
    const user = await this.users.findById(id);
    if (!user) throw Problems.notFound();
    return user;
  }

  /** Adds an invited user. Invited users don't use a seat until they accept (first login). */
  async create(body: CreateUserDto): Promise<UserRow> {
    if (await this.users.emailExists(body.email)) throw OrgErrors.emailTaken();
    const user = await this.users
      .create(
        {
          email: body.email,
          fullName: body.fullName,
          roleId: body.roleId,
          phone: body.phone ?? null,
          teamId: body.teamId ?? null,
          languages: body.languages ?? [],
          location: body.location ?? null,
        },
        this.tenantId(),
      )
      .catch(this.rethrowUnique);
    await this.audit.record('create', 'users', user.id, { email: [null, user.email], roleId: [null, user.roleId], status: [null, user.status] });
    // Invitation email is sent once the email service (SES) is connected.
    this.logger.log(`invitation pending for user ${user.id}`);
    return user;
  }

  async update(id: string, body: UpdateUserDto, expectedVersion?: string): Promise<UserRow> {
    const before = await this.get(id);
    if (body.email && (await this.users.emailExists(body.email, id))) throw OrgErrors.emailTaken();
    const patch: UserPatch = {};
    for (const key of EDITABLE) if (body[key] !== undefined) (patch as Record<string, unknown>)[key] = body[key];
    if (!Object.keys(patch).length) return before;
    return this.save(before, patch, expectedVersion);
  }

  /** Admin switch: the user keeps existing leads but gets no new ones while off (SRS §4.2). */
  async setReceivesLeads(id: string, receivesLeads: boolean): Promise<UserRow> {
    const before = await this.get(id);
    if (before.receivesLeads === receivesLeads) return before;
    const after = await this.save(before, { receivesLeads });
    await this.events.publish('user.receives_leads_changed', { tenantId: after.tenantId, userId: id, receivesLeads });
    return after;
  }

  async deactivate(id: string, body: DeactivateUserDto): Promise<UserRow> {
    const before = await this.get(id);
    if (before.status === 'inactive') return before;
    const leads = this.leads;
    if (leads) {
      const open = await leads.countOpenLeads(id);
      if (open > 0) {
        if (!body.reassignToUserId) throw OrgErrors.userHasOpenLeads(open);
        const target = await this.get(body.reassignToUserId);
        if (target.status !== 'active' || target.id === id) throw OrgErrors.invalidState('Leads can only move to another active user.');
        await leads.reassignOpenLeads(id, target.id);
      }
    }
    return this.save(before, { status: 'inactive' });
  }

  /** Reactivating takes a seat; the database refuses it when all paid seats are used. */
  async reactivate(id: string): Promise<UserRow> {
    const before = await this.get(id);
    if (before.status !== 'inactive') throw OrgErrors.invalidState('Only an inactive user can be reactivated.');
    return this.save(before, { status: 'active' });
  }

  private async save(before: UserRow, patch: UserPatch, expectedVersion?: string): Promise<UserRow> {
    let after: UserRow | undefined;
    try {
      after = await this.users.update(before.id, patch, expectedVersion);
    } catch (err) {
      if (isSeatLimit(err)) throw OrgErrors.seatLimitReached();
      this.rethrowUnique(err);
    }
    if (!after) throw expectedVersion ? versionConflict() : Problems.notFound();
    const action = patch.roleId !== undefined && patch.roleId !== before.roleId ? 'permission_change' : 'update';
    await this.audit.recordUpdate('users', before.id, pickAudited(before), pickAudited(after), action);
    return after;
  }

  private readonly rethrowUnique = (err: unknown): never => {
    if (pgCode(err) === PG_UNIQUE_VIOLATION) throw OrgErrors.emailTaken();
    throw err;
  };

  private tenantId(): string {
    return this.db.currentTenantId!;
  }
}

function pickAudited(u: UserRow): Record<string, unknown> {
  return Object.fromEntries(AUDITED.map((k) => [k, u[k]]));
}
