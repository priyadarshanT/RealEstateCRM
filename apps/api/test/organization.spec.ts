import { INestApplication } from '@nestjs/common';
import { createTestApp, ownerQuery, signIn, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

// Team menu: organization profile, users, roles and permissions, teams, divisions, audit log (SRS §4, §12 Seats, §13, §14).
describe('organization module', () => {
  let app: INestApplication;
  let admin: Client;
  let agent: Client;
  let leader: Client;
  let adminB: Client;
  let roleIds: Record<string, string>;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signIn(app, USERS.adminA);
    agent = await signIn(app, USERS.aliA);
    leader = await signIn(app, USERS.saraA);
    adminB = await signIn(app, USERS.adminB);
    const roles = await admin.get('/api/v1/roles').expect(200);
    roleIds = Object.fromEntries(roles.body.data.map((r: { key: string; id: string }) => [r.key, r.id]));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('organization profile', () => {
    it('any signed-in user can read it; only settings.manage can change it', async () => {
      const res = await agent.get('/api/v1/organization').expect(200);
      expect(res.body).toMatchObject({ name: 'Al Noor Realty', verificationStatus: 'pending', baseCurrency: 'AED' });
      await agent.patch('/api/v1/organization').send({ website: 'https://alnoor.ae' }).expect(403);
    });

    it('Admin updates allowed fields; the change is audited as setting_change', async () => {
      const res = await admin.patch('/api/v1/organization').send({ website: 'https://alnoor.ae', verificationStatus: 'verified' }).expect(200);
      expect(res.body).toMatchObject({ website: 'https://alnoor.ae', verificationStatus: 'pending' });
      const audit = await admin.get('/api/v1/audit-logs?entityType=tenants&action=setting_change').expect(200);
      expect(audit.body.data[0]).toMatchObject({ userId: USERS.adminA.id, changes: { website: [null, 'https://alnoor.ae'] } });
    });

    it('rejects invalid input with 400 and field errors', async () => {
      const res = await admin.patch('/api/v1/organization').send({ phone: '0501234567' }).expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED', errors: [{ field: 'phone' }] });
    });
  });

  describe('roles and permissions', () => {
    it('lists the 25 permissions and the 7 built-in roles; only Admin may export', async () => {
      const perms = await admin.get('/api/v1/permissions').expect(200);
      expect(perms.body.data).toHaveLength(25);
      const roles = await admin.get('/api/v1/roles').expect(200);
      const builtIn = roles.body.data.filter((r: { isSystem: boolean }) => r.isSystem);
      expect(builtIn.map((r: { key: string }) => r.key).sort()).toEqual(
        ['admin', 'director', 'finance', 'general_manager', 'sales_agent', 'sales_manager', 'team_leader'].sort(),
      );
      const exporters = roles.body.data.filter((r: { permissions: string[] }) => r.permissions.includes('leads.export'));
      expect(exporters.map((r: { key: string }) => r.key)).toEqual(['admin']);
    });

    it('agents and team leaders cannot manage roles', async () => {
      await agent.get('/api/v1/roles').expect(403);
      await leader.post('/api/v1/roles').send({ key: 'x', name: 'X', dataScope: 'own', permissions: [] }).expect(403);
    });

    it('Admin creates a custom role, changes it, and cannot delete it while in use', async () => {
      const created = await admin
        .post('/api/v1/roles')
        .send({ key: 'hr', name: 'HR', dataScope: 'company', permissions: ['attendance.view', 'attendance.approve'] })
        .expect(201);
      expect(created.body).toMatchObject({ key: 'hr', isSystem: false, permissions: ['attendance.approve', 'attendance.view'] });
      const hrId = created.body.id;

      await admin.post('/api/v1/roles').send({ key: 'hr', name: 'HR 2', dataScope: 'own', permissions: [] }).expect(409);
      const unknown = await admin.post('/api/v1/roles').send({ key: 'basic', name: 'Basic', dataScope: 'own', permissions: ['nope'] }).expect(400);
      expect(unknown.body.errors[0].message).toMatch(/unknown permission/);

      const updated = await admin.patch(`/api/v1/roles/${hrId}`).send({ permissions: ['attendance.view'] }).expect(200);
      expect(updated.body.permissions).toEqual(['attendance.view']);

      const user = await admin.post('/api/v1/users').send({ email: 'hr.person@a.ae', fullName: 'HR Person', roleId: hrId }).expect(201);
      const inUse = await admin.delete(`/api/v1/roles/${hrId}`).expect(409);
      expect(inUse.body.code).toBe('ROLE_IN_USE');

      await admin.patch(`/api/v1/users/${user.body.id}`).send({ roleId: roleIds.sales_agent }).expect(200);
      await admin.delete(`/api/v1/roles/${hrId}`).expect(204);

      const audit = await admin.get(`/api/v1/audit-logs?entityId=${hrId}`).expect(200);
      expect(audit.body.data.map((e: { action: string }) => e.action)).toEqual(['delete', 'permission_change', 'permission_change']);
    });

    it('built-in roles cannot be deleted or have their key changed, but their permissions can change', async () => {
      await admin.delete(`/api/v1/roles/${roleIds.finance}`).expect(403);
      await admin.patch(`/api/v1/roles/${roleIds.finance}`).send({ key: 'money' }).expect(403);
      await admin.patch(`/api/v1/roles/${roleIds.finance}`).send({ name: 'Finance Team' }).expect(200);
    });
  });

  describe('users', () => {
    it('agents cannot list users', async () => {
      await agent.get('/api/v1/users').expect(403);
    });

    it('lists users by name with cursor paging and search', async () => {
      const first = await admin.get('/api/v1/users?limit=2').expect(200);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.page).toMatchObject({ hasMore: true });
      const second = await admin.get(`/api/v1/users?limit=2&cursor=${first.body.page.nextCursor}`).expect(200);
      const ids = [...first.body.data, ...second.body.data].map((u: { id: string }) => u.id);
      expect(new Set(ids).size).toBe(ids.length);

      const search = await admin.get('/api/v1/users?q=MIRA').expect(200);
      expect(search.body.data.map((u: { email: string }) => u.email)).toEqual(['mira@a.ae']);
      await admin.get('/api/v1/users?cursor=not-a-cursor').expect(400);
    });

    it('invites a user (status invited); a duplicate email is refused', async () => {
      const res = await admin
        .post('/api/v1/users')
        .send({ email: 'Omar@A.ae', fullName: 'Omar', roleId: roleIds.sales_agent, phone: '+971501112233', languages: ['ar', 'en'] })
        .expect(201);
      expect(res.body).toMatchObject({ email: 'omar@a.ae', status: 'invited', receivesLeads: true, languages: ['ar', 'en'] });
      await admin.post('/api/v1/users').send({ email: 'omar@a.ae', fullName: 'Omar 2', roleId: roleIds.sales_agent }).expect(409);
    });

    it('PATCH with a stale If-Match returns 409 VERSION_CONFLICT; with the current ETag it saves', async () => {
      const current = await admin.get(`/api/v1/users/${USERS.miraA.id}`).expect(200);
      const etag = current.headers.etag as string;
      await admin.patch(`/api/v1/users/${USERS.miraA.id}`).set('If-Match', etag).send({ location: 'Marina' }).expect(200);
      const stale = await admin.patch(`/api/v1/users/${USERS.miraA.id}`).set('If-Match', etag).send({ location: 'JLT' }).expect(409);
      expect(stale.body.code).toBe('VERSION_CONFLICT');
    });

    it('PATCH ignores status and receivesLeads (they have their own endpoints)', async () => {
      const res = await admin.patch(`/api/v1/users/${USERS.miraA.id}`).send({ status: 'inactive', receivesLeads: false, fullName: 'Mira K' }).expect(200);
      expect(res.body).toMatchObject({ fullName: 'Mira K', status: 'active', receivesLeads: true });
    });

    it('only users.lead_assignment (Admin) can turn lead assignment on or off', async () => {
      await leader.put(`/api/v1/users/${USERS.aliA.id}/receives-leads`).send({ receivesLeads: false }).expect(403);
      const off = await admin.put(`/api/v1/users/${USERS.aliA.id}/receives-leads`).send({ receivesLeads: false }).expect(200);
      expect(off.body.receivesLeads).toBe(false);
      await admin.put(`/api/v1/users/${USERS.aliA.id}/receives-leads`).send({ receivesLeads: true }).expect(200);
    });

    it('seats: an invited user takes a seat on first login; no free seat → SEAT_LIMIT_REACHED', async () => {
      await admin.post('/api/v1/users').send({ email: 'nina@a.ae', fullName: 'Nina', roleId: roleIds.sales_agent }).expect(201);
      const nina = await signIn(app, { email: 'nina@a.ae', tenant: USERS.adminA.tenant });
      const full = await nina.get('/api/v1/me').expect(422);
      expect(full.body.code).toBe('SEAT_LIMIT_REACHED');

      // Mira may own leads (leads tests): they move to the Admin before she is deactivated (SRS §4.3).
      await admin.post(`/api/v1/users/${USERS.miraA.id}/deactivate`).send({ reassignToUserId: USERS.adminA.id }).expect(200);
      await (await signIn(app, USERS.miraA)).get('/api/v1/me').expect(401);

      const me = await nina.get('/api/v1/me').expect(200);
      expect(me.body.user.status).toBe('active');

      const noSeat = await admin.post(`/api/v1/users/${USERS.miraA.id}/reactivate`).expect(422);
      expect(noSeat.body.code).toBe('SEAT_LIMIT_REACHED');

      await admin.post(`/api/v1/users/${me.body.user.id}/deactivate`).send({}).expect(200);
      const back = await admin.post(`/api/v1/users/${USERS.miraA.id}/reactivate`).expect(200);
      expect(back.body.status).toBe('active');
      await admin.post(`/api/v1/users/${USERS.miraA.id}/reactivate`).expect(422);
    });

    it('changing a user role is audited as permission_change', async () => {
      const user = await admin.post('/api/v1/users').send({ email: 'zaid@a.ae', fullName: 'Zaid', roleId: roleIds.sales_agent }).expect(201);
      await admin.patch(`/api/v1/users/${user.body.id}`).send({ roleId: roleIds.team_leader }).expect(200);
      const audit = await admin.get(`/api/v1/audit-logs?entityId=${user.body.id}&action=permission_change`).expect(200);
      expect(audit.body.data[0].changes.roleId).toEqual([roleIds.sales_agent, roleIds.team_leader]);
    });
  });

  describe('teams and divisions', () => {
    it('Admin builds the hierarchy: division → team, then moves a user into the team', async () => {
      const division = await admin.post('/api/v1/divisions').send({ name: 'Off-plan', gmUserId: USERS.adminA.id }).expect(201);
      await admin.post('/api/v1/divisions').send({ name: 'Off-plan' }).expect(409);
      await admin.post('/api/v1/divisions').send({}).expect(400);

      const team = await admin
        .post('/api/v1/teams')
        .send({ name: 'Team Marina', divisionId: division.body.id, teamLeaderUserId: USERS.saraA.id })
        .expect(201);
      expect(team.body).toMatchObject({ name: 'Team Marina', divisionId: division.body.id, isActive: true });

      await admin.patch(`/api/v1/users/${USERS.aliA.id}`).send({ teamId: team.body.id }).expect(200);
      const members = await admin.get(`/api/v1/users?teamId=${team.body.id}`).expect(200);
      expect(members.body.data.map((u: { id: string }) => u.id)).toEqual([USERS.aliA.id]);

      const renamed = await admin.patch(`/api/v1/teams/${team.body.id}`).send({ name: 'Team Marina 1' }).expect(200);
      expect(renamed.body.name).toBe('Team Marina 1');

      // In use: the division has a team, the team has a member.
      expect((await admin.delete(`/api/v1/divisions/${division.body.id}`).expect(409)).body.code).toBe('CONFLICT');
      await admin.delete(`/api/v1/teams/${team.body.id}`).expect(409);

      await admin.patch(`/api/v1/users/${USERS.aliA.id}`).send({ teamId: null }).expect(200);
      await admin.delete(`/api/v1/teams/${team.body.id}`).expect(204);
      await admin.delete(`/api/v1/divisions/${division.body.id}`).expect(204);
      await admin.get(`/api/v1/teams/${team.body.id}`).expect(404);
    });

    it('a team leader from another tenant cannot be linked', async () => {
      const res = await admin.post('/api/v1/teams').send({ name: 'Bad link', teamLeaderUserId: USERS.adminB.id }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('lists teams and divisions with paging', async () => {
      await admin.post('/api/v1/teams').send({ name: 'Team A' }).expect(201);
      await admin.post('/api/v1/teams').send({ name: 'Team B' }).expect(201);
      const page = await admin.get('/api/v1/teams?limit=1').expect(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.page.hasMore).toBe(true);
      const next = await admin.get(`/api/v1/teams?limit=1&cursor=${page.body.page.nextCursor}`).expect(200);
      expect(next.body.data[0].name > page.body.data[0].name).toBe(true);
      await admin.get('/api/v1/divisions').expect(200);
    });
  });

  describe('tenant isolation and audit log', () => {
    it("another tenant's records return 404", async () => {
      await adminB.get(`/api/v1/users/${USERS.aliA.id}`).expect(404);
      await adminB.patch(`/api/v1/users/${USERS.aliA.id}`).send({ fullName: 'x' }).expect(404);
      await adminB.delete(`/api/v1/roles/${roleIds.finance}`).expect(404);
      const list = await adminB.get('/api/v1/users').expect(200);
      expect(list.body.data.map((u: { email: string }) => u.email)).toEqual(['admin@b.ae']);
    });

    it('only audit.view (Admin, Director) can read the audit log, and it cannot be edited', async () => {
      await agent.get('/api/v1/audit-logs').expect(403);
      const res = await admin.get('/api/v1/audit-logs?limit=5').expect(200);
      expect(res.body.data.length).toBe(5);
      expect(res.body.page.hasMore).toBe(true);
      const other = await adminB.get('/api/v1/audit-logs').expect(200);
      expect(other.body.data.every((e: { userId: string | null }) => e.userId === USERS.adminB.id || e.userId === null)).toBe(true);
      const rows = await ownerQuery<{ n: string }>(`SELECT count(*) AS n FROM audit_logs`);
      expect(Number(rows[0]!.n)).toBeGreaterThan(10);
    });
  });
});
