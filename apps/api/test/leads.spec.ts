import { INestApplication } from '@nestjs/common';
import { DbService } from '../src/core/database/db.service';
import { LeadIntakeService } from '../src/modules/leads/lead-intake.service';
import { createTestApp, ownerQuery, signIn, TENANT_A, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

const SOURCE_META_A = 'a1000000-0000-0000-0000-000000000001';
const SAMPLE_LEAD = 'a2000000-0000-0000-0000-000000000001'; // Ahmed, owned by Ali, stage Pending
const PROJECT_BEACHFRONT = 'a4000000-0000-0000-0000-000000000001';

// Leads (SRS §2, §13; API guide §3–§6). Runs against crm_test as crm_app.
describe('leads module', () => {
  let app: INestApplication;
  let admin: Client;
  let ali: Client; // agent
  let mira: Client; // agent
  let sara: Client; // team leader
  let adminB: Client;
  let stage: Record<string, string>;
  let reason: Record<string, string>;
  let teamId: string;

  const uniquePhone = (() => {
    let n = 5_550_000;
    return () => `+97155${(n++).toString().padStart(7, '0')}`;
  })();

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signIn(app, USERS.adminA);
    ali = await signIn(app, USERS.aliA);
    mira = await signIn(app, USERS.miraA);
    sara = await signIn(app, USERS.saraA);
    adminB = await signIn(app, USERS.adminB);
    const stages = await admin.get('/api/v1/lead-stages?limit=200').expect(200);
    stage = Object.fromEntries(stages.body.data.map((s: { key: string; id: string }) => [s.key, s.id]));
    const reasons = await admin.get('/api/v1/reasons?limit=200').expect(200);
    reason = Object.fromEntries(reasons.body.data.map((r: { type: string; name: string; id: string }) => [`${r.type}:${r.name}`, r.id]));
    // Team: Sara leads it, Ali is a member.
    const team = await admin.post('/api/v1/teams').send({ name: 'Leads Test Team', teamLeaderUserId: USERS.saraA.id }).expect(201);
    teamId = team.body.id;
    await admin.patch(`/api/v1/users/${USERS.aliA.id}`).send({ teamId }).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  async function newLead(client: Client, extra: Record<string, unknown> = {}) {
    const res = await client.post('/api/v1/leads').send({ fullName: 'Test Lead', phonePrimary: uniquePhone(), sourceId: SOURCE_META_A, ...extra }).expect(201);
    return res.body;
  }

  describe('create and duplicates', () => {
    it('creates a lead in stage New with its first enquiry, history and timeline', async () => {
      const lead = await newLead(admin, { email: 'Buyer.One@Mail.com', budgetMin: '1000000', budgetMax: '2500000.5', budgetCurrency: 'AED', projectIds: [PROJECT_BEACHFRONT], note: 'Wants sea view' });
      expect(lead).toMatchObject({ stageId: stage.new, stageCategory: 'open', email: 'buyer.one@mail.com', budgetMax: '2500000.50', projectIds: [PROJECT_BEACHFRONT], latestNote: 'Wants sea view', version: 1, score: 0, enquiryCount: 1 });
      const timeline = await admin.get(`/api/v1/leads/${lead.id}/timeline`).expect(200);
      expect(timeline.body.data.map((a: { type: string }) => a.type).sort()).toEqual(['inquiry', 'note']);
      const inquiries = await admin.get(`/api/v1/leads/${lead.id}/inquiries`).expect(200);
      expect(inquiries.body.data).toHaveLength(1);
    });

    it('a phone or an email is required; a budget needs a currency', async () => {
      await admin.post('/api/v1/leads').send({ fullName: 'No contact', sourceId: SOURCE_META_A }).expect(400);
      await admin.post('/api/v1/leads').send({ fullName: 'X', phonePrimary: uniquePhone(), sourceId: SOURCE_META_A, budgetMin: '10' }).expect(400);
      await admin.post('/api/v1/leads').send({ fullName: 'X', phonePrimary: '0501234567', sourceId: SOURCE_META_A }).expect(400);
    });

    it('an existing phone returns 409 LEAD_EXISTS with the owner, and check-existing warns while typing', async () => {
      const res = await admin.post('/api/v1/leads').send({ fullName: 'Ahmed again', phonePrimary: '+971501234567', sourceId: SOURCE_META_A }).expect(409);
      expect(res.body).toMatchObject({ code: 'LEAD_EXISTS', lead: { leadId: SAMPLE_LEAD, ownerUserId: USERS.aliA.id, ownerName: 'Ali', stageName: 'Pending' } });
      expect(res.body.detail).toBe('This lead already exists, owned by Ali.');
      const check = await mira.get('/api/v1/leads/check-existing?phone=%2B971501234567').expect(200);
      expect(check.body).toMatchObject({ exists: true, lead: { leadId: SAMPLE_LEAD } });
      const none = await mira.get('/api/v1/leads/check-existing?email=nobody@x.ae').expect(200);
      expect(none.body).toEqual({ exists: false, lead: null });
    });

    it('Idempotency-Key: a retried create returns the first result instead of a duplicate', async () => {
      const body = { fullName: 'Retry Lead', phonePrimary: uniquePhone(), sourceId: SOURCE_META_A };
      const first = await admin.post('/api/v1/leads').set('Idempotency-Key', 'create-retry-1').send(body).expect(201);
      const second = await admin.post('/api/v1/leads').set('Idempotency-Key', 'create-retry-1').send(body).expect(201);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body.id).toBe(first.body.id);
      const other = await admin.post('/api/v1/leads').set('Idempotency-Key', 'create-retry-1').send({ ...body, fullName: 'Changed' }).expect(422);
      expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('an agent cannot choose another owner; Admin can, and the owner gets the response timer', async () => {
      await ali.post('/api/v1/leads').send({ fullName: 'X', phonePrimary: uniquePhone(), sourceId: SOURCE_META_A, ownerUserId: USERS.miraA.id }).expect(403);
      const lead = await newLead(admin, { ownerUserId: USERS.miraA.id });
      expect(lead.ownerUserId).toBe(USERS.miraA.id);
      const due = new Date(lead.responseDueAt).getTime() - Date.now();
      expect(due).toBeGreaterThan(8 * 60_000);
      expect(due).toBeLessThanOrEqual(15 * 60_000 + 5000); // 10 minutes by default (another test may set 15)
      expect(lead.nextFollowUpAt).not.toBeNull();
    });
  });

  describe('data scope and sharing', () => {
    it("an agent sees only their own and shared leads; another agent's lead is 404", async () => {
      const mine = await ali.get('/api/v1/leads?tab=my&limit=200').expect(200);
      expect(mine.body.data.map((l: { id: string }) => l.id)).toContain(SAMPLE_LEAD);
      expect(mine.body.data.every((l: { access: string }) => l.access === 'owner')).toBe(true);
      await mira.get(`/api/v1/leads/${SAMPLE_LEAD}`).expect(404);
      await adminB.get(`/api/v1/leads/${SAMPLE_LEAD}`).expect(404);
    });

    it("the team leader sees her team's leads with scope access", async () => {
      const lead = await newLead(admin, { ownerUserId: USERS.aliA.id });
      const res = await sara.get(`/api/v1/leads/${lead.id}`).expect(200);
      expect(res.body).toMatchObject({ access: 'scope', teamId });
      const team = await sara.get('/api/v1/leads?tab=team&limit=200').expect(200);
      expect(team.body.data.map((l: { id: string }) => l.id)).toContain(lead.id);
    });

    it('sharing: view-only cannot edit; can-edit can add notes; only owner or manager can share', async () => {
      const lead = await newLead(admin, { ownerUserId: USERS.aliA.id });
      await mira.post(`/api/v1/leads/${lead.id}/shares`).send({ userId: USERS.miraA.id, access: 'edit' }).expect(404);
      const shared = await ali.post(`/api/v1/leads/${lead.id}/shares`).send({ userId: USERS.miraA.id, access: 'view' }).expect(201);
      expect(shared.body).toMatchObject({ userId: USERS.miraA.id, userName: expect.stringMatching(/^Mira/), access: 'view', sharedBy: USERS.aliA.id });

      const seen = await mira.get(`/api/v1/leads/${lead.id}`).expect(200);
      expect(seen.body.access).toBe('view');
      await mira.post(`/api/v1/leads/${lead.id}/notes`).send({ body: 'hi' }).expect(403);
      const sharedTab = await mira.get('/api/v1/leads?tab=shared&limit=200').expect(200);
      expect(sharedTab.body.data.map((l: { id: string }) => l.id)).toContain(lead.id);

      await ali.post(`/api/v1/leads/${lead.id}/shares`).send({ userId: USERS.miraA.id, access: 'edit' }).expect(201);
      await mira.post(`/api/v1/leads/${lead.id}/notes`).send({ body: 'Called from my side' }).expect(201);
      await mira.post(`/api/v1/leads/${lead.id}/shares`).send({ userId: USERS.saraA.id, access: 'view' }).expect(403);

      await ali.delete(`/api/v1/leads/${lead.id}/shares/${USERS.miraA.id}`).expect(204);
      await mira.get(`/api/v1/leads/${lead.id}`).expect(404);
      const audit = await admin.get(`/api/v1/audit-logs?entityType=lead_shares&entityId=${lead.id}`).expect(200);
      expect(audit.body.data).toHaveLength(3);
    });
  });

  describe('stage, owner, notes', () => {
    it('Lost needs a reason of the right type; reopening needs a next follow-up; history and timeline are kept', async () => {
      const lead = await newLead(admin, { ownerUserId: USERS.aliA.id });
      const noReason = await ali.post(`/api/v1/leads/${lead.id}/stage`).send({ stageId: stage.lost }).expect(422);
      expect(noReason.body.code).toBe('REASON_REQUIRED');
      await ali.post(`/api/v1/leads/${lead.id}/stage`).send({ stageId: stage.lost, reasonId: reason['invalid:Wrong number'] }).expect(400);
      const lost = await ali.post(`/api/v1/leads/${lead.id}/stage`).send({ stageId: stage.lost, reasonId: reason['lost:Budget too low'], note: 'Too expensive' }).expect(200);
      expect(lost.body).toMatchObject({ stageCategory: 'lost', closeReasonId: reason['lost:Budget too low'], responseDueAt: null });

      const back = await ali.post(`/api/v1/leads/${lead.id}/stage`).send({ stageId: stage.follow_up, nextFollowUpAt: '2030-01-01T09:00:00Z' }).expect(200);
      expect(back.body).toMatchObject({ stageCategory: 'open', closeReasonId: null, nextFollowUpAt: '2030-01-01T09:00:00.000Z' });
      const history = await ownerQuery<{ n: number }>(`SELECT count(*)::int AS n FROM lead_stage_history WHERE lead_id = $1`, [lead.id]);
      expect(history[0]!.n).toBe(3);
      const timeline = await ali.get(`/api/v1/leads/${lead.id}/timeline?types=stage_change`).expect(200);
      expect(timeline.body.data[0].summary).toBe('Stage: Lost → Follow-up');
    });

    it("the owner's first note stops the 10-minute timer; someone else's note does not", async () => {
      const lead = await newLead(admin, { ownerUserId: USERS.aliA.id });
      expect(lead.responseDueAt).not.toBeNull();
      await sara.post(`/api/v1/leads/${lead.id}/notes`).send({ body: 'Manager note' }).expect(201);
      expect((await ali.get(`/api/v1/leads/${lead.id}`).expect(200)).body.responseDueAt).not.toBeNull();
      await ali.post(`/api/v1/leads/${lead.id}/notes`).send({ body: 'Called, interested' }).expect(201);
      const after = await ali.get(`/api/v1/leads/${lead.id}`).expect(200);
      expect(after.body).toMatchObject({ responseDueAt: null, latestNote: 'Called, interested' });
    });

    it('reassigning needs a reason; a user with lead assignment off cannot receive leads', async () => {
      const lead = await newLead(admin, { ownerUserId: USERS.aliA.id });
      const noReason = await admin.post(`/api/v1/leads/${lead.id}/assign`).send({ toUserId: USERS.miraA.id }).expect(422);
      expect(noReason.body.code).toBe('REASON_REQUIRED');
      await ali.post(`/api/v1/leads/${lead.id}/assign`).send({ toUserId: USERS.miraA.id, reasonId: reason['reassignment:Agent unavailable'] }).expect(403);

      await admin.put(`/api/v1/users/${USERS.miraA.id}/receives-leads`).send({ receivesLeads: false }).expect(200);
      const off = await admin.post(`/api/v1/leads/${lead.id}/assign`).send({ toUserId: USERS.miraA.id, reasonId: reason['reassignment:Agent unavailable'] }).expect(422);
      expect(off.body.code).toBe('USER_NOT_RECEIVING_LEADS');
      await admin.put(`/api/v1/users/${USERS.miraA.id}/receives-leads`).send({ receivesLeads: true }).expect(200);

      const moved = await admin.post(`/api/v1/leads/${lead.id}/assign`).send({ toUserId: USERS.miraA.id, reasonId: reason['reassignment:Agent unavailable'], note: 'Ali on leave' }).expect(200);
      expect(moved.body.ownerUserId).toBe(USERS.miraA.id);
      const log = await ownerQuery<{ method: string; reason_id: string }>(`SELECT method, reason_id FROM lead_assignments WHERE lead_id = $1 ORDER BY changed_at`, [lead.id]);
      expect(log.map((l) => l.method)).toEqual(['manual', 'manual']);
      expect(log[1]!.reason_id).toBe(reason['reassignment:Agent unavailable']);
    });

    it('edit with a stale version returns 409 VERSION_CONFLICT', async () => {
      const lead = await newLead(admin, { ownerUserId: USERS.aliA.id });
      const saved = await ali.patch(`/api/v1/leads/${lead.id}`).send({ version: lead.version, preferredLanguage: 'ar', priority: 'high' }).expect(200);
      expect(saved.body).toMatchObject({ preferredLanguage: 'ar', priority: 'high', version: lead.version + 1 });
      const stale = await ali.patch(`/api/v1/leads/${lead.id}`).send({ version: lead.version, fullName: 'Late' }).expect(409);
      expect(stale.body.code).toBe('VERSION_CONFLICT');
    });
  });

  describe('delete, restore, bulk, lists', () => {
    it('only users with leads.delete delete and restore; deleted leads are in the Deleted tab', async () => {
      const lead = await newLead(admin, { ownerUserId: USERS.aliA.id });
      await ali.delete(`/api/v1/leads/${lead.id}`).expect(403);
      await admin.delete(`/api/v1/leads/${lead.id}`).expect(204);
      await ali.get(`/api/v1/leads/${lead.id}`).expect(404);
      await ali.get('/api/v1/leads?tab=deleted').expect(403);
      const deleted = await admin.get('/api/v1/leads?tab=deleted&limit=200').expect(200);
      expect(deleted.body.data.map((l: { id: string }) => l.id)).toContain(lead.id);
      const restored = await admin.post(`/api/v1/leads/${lead.id}/restore`).expect(200);
      expect(restored.body.deletedAt).toBeNull();
    });

    it('bulk reports each lead separately', async () => {
      const a = await newLead(admin);
      const b = await newLead(admin, { ownerUserId: USERS.aliA.id });
      const res = await admin.post('/api/v1/leads/bulk').send({ leadIds: [a.id, b.id], action: 'assign', toUserId: USERS.miraA.id }).expect(200);
      expect(res.body.succeeded).toEqual([a.id]);
      expect(res.body.failed).toEqual([{ id: b.id, code: 'REASON_REQUIRED', message: expect.any(String) }]);
      await ali.post('/api/v1/leads/bulk').send({ leadIds: [a.id], action: 'delete' }).expect(403);
    });

    it('tabs, filters, sorting, paging and total', async () => {
      const unassigned = await admin.get('/api/v1/leads?tab=unassigned&limit=200').expect(200);
      expect(unassigned.body.data.every((l: { ownerUserId: string | null }) => l.ownerUserId === null)).toBe(true);
      const pending = await admin.get('/api/v1/leads?tab=pending&limit=200').expect(200);
      expect(pending.body.data.map((l: { id: string }) => l.id)).toContain(SAMPLE_LEAD);
      const search = await admin.get('/api/v1/leads?q=501234567').expect(200);
      expect(search.body.data.map((l: { id: string }) => l.id)).toEqual([SAMPLE_LEAD]);
      const byProject = await admin.get(`/api/v1/leads?projectId=${PROJECT_BEACHFRONT}&limit=200`).expect(200);
      expect(byProject.body.data.length).toBeGreaterThan(0);
      const page1 = await admin.get('/api/v1/leads?limit=2&total=true&sort=-createdAt').expect(200);
      expect(page1.body.page).toMatchObject({ hasMore: true, total: expect.any(Number) });
      const page2 = await admin.get(`/api/v1/leads?limit=2&sort=-createdAt&cursor=${page1.body.page.nextCursor}`).expect(200);
      expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);
      await admin.get('/api/v1/leads?sort=password').expect(400);
    });

    it('saved filters: private per user, shared with a team, applied to the list', async () => {
      const saved = await sara.post('/api/v1/saved-filters').send({ entity: 'leads', name: 'Pending only', filters: { tab: 'pending' }, sharedTeamId: teamId }).expect(201);
      const aliSees = await ali.get('/api/v1/saved-filters?entity=leads').expect(200);
      expect(aliSees.body.data.map((f: { id: string }) => f.id)).toContain(saved.body.id);
      const applied = await ali.get(`/api/v1/leads?savedFilterId=${saved.body.id}&limit=200`).expect(200);
      expect(applied.body.data.every((l: { stageId: string }) => l.stageId === stage.pending)).toBe(true);
      await ali.delete(`/api/v1/saved-filters/${saved.body.id}`).expect(404);
      await sara.delete(`/api/v1/saved-filters/${saved.body.id}`).expect(204);
    });

    it('global search is limited to the scope; workload counts open leads', async () => {
      const res = await mira.get('/api/v1/search?q=Ahmed').expect(200);
      expect(res.body.leads).toEqual([]);
      const own = await ali.get('/api/v1/search?q=Ahmed').expect(200);
      expect(own.body.leads.map((l: { id: string }) => l.id)).toContain(SAMPLE_LEAD);
      const workload = await admin.get(`/api/v1/users/${USERS.aliA.id}/workload`).expect(200);
      expect(workload.body.openLeads).toBeGreaterThan(0);
    });
  });

  describe('intake: re-enquiries (SRS §2.3–2.8)', () => {
    let intake: LeadIntakeService;
    let db: DbService;
    const receive = (input: Parameters<LeadIntakeService['receive']>[0]) => db.withTenant(TENANT_A, () => intake.receive(input));

    beforeAll(() => {
      intake = app.get(LeadIntakeService);
      db = app.get(DbService);
    });

    it('a known phone becomes a re-enquiry on the same lead; the same submission is never imported twice', async () => {
      const first = await receive({ sourceId: SOURCE_META_A, fullName: 'Ahmed', phone: '00971 50 123 4567', externalSubmissionId: 'META-900', formAnswers: { budget: '4M' } });
      expect(first).toEqual({ status: 're_enquired', leadId: SAMPLE_LEAD, reopened: false });
      expect(await receive({ sourceId: SOURCE_META_A, phone: '+971501234567', externalSubmissionId: 'META-900' })).toEqual({ status: 'duplicate' });
      const lead = await ali.get(`/api/v1/leads/${SAMPLE_LEAD}`).expect(200);
      expect(lead.body).toMatchObject({ enquiryCount: 2, ownerUserId: USERS.aliA.id });
      const timeline = await ali.get(`/api/v1/leads/${SAMPLE_LEAD}/timeline?types=re_enquiry`).expect(200);
      expect(timeline.body.data[0].summary).toBe('Re-enquired via Meta');
    });

    it('a Lost lead reopens in Follow-up with the same agent', async () => {
      const lead = await newLead(admin, { ownerUserId: USERS.aliA.id, email: 'reopen@x.ae' });
      await ali.post(`/api/v1/leads/${lead.id}/stage`).send({ stageId: stage.lost, reasonId: reason['lost:Not interested'] }).expect(200);
      const result = await receive({ sourceId: SOURCE_META_A, email: 'REOPEN@x.ae' });
      expect(result).toEqual({ status: 're_enquired', leadId: lead.id, reopened: true });
      const after = await ali.get(`/api/v1/leads/${lead.id}`).expect(200);
      expect(after.body).toMatchObject({ stageId: stage.follow_up, ownerUserId: USERS.aliA.id, enquiryCount: 2 });
    });

    it('a new contact creates a lead; invalid rows are rejected with reasons', async () => {
      const created = await receive({ sourceId: SOURCE_META_A, fullName: 'Priya Sharma', phone: '+971559871122', formAnswers: { interested_in: 'Sobha Hartland' } });
      expect(created.status).toBe('created');
      expect(await receive({ sourceId: SOURCE_META_A, phone: '050 123' })).toEqual({
        status: 'rejected',
        errors: ['phone "050 123" is not a valid international number', 'a phone or an email is required'],
      });
    });
  });
});
