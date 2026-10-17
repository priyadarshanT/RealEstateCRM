import { INestApplication } from '@nestjs/common';
import { TaskJobs } from '../src/modules/tasks/task-jobs';
import { createTestApp, ownerQuery, signIn, TENANT_B, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

const SOURCE_META_B = 'b1000000-0000-0000-0000-000000000001';

// Assignment rules and round-robin, the 10-minute rule, tasks and calls, reminders, notifications
// (SRS §3, §4.8–4.10). Runs in tenant B (no seat limit), which the other test files leave alone.
describe('assignment, rotation, tasks, notifications', () => {
  let app: INestApplication;
  let jobs: TaskJobs;
  let admin: Client;
  const agents: { id: string; client: Client }[] = [];
  let teamId: string;
  let sourceWeb: string;
  let phone = 5_660_000;
  const nextPhone = () => `+97156${(phone++).toString().padStart(7, '0')}`;

  beforeAll(async () => {
    app = await createTestApp();
    jobs = app.get(TaskJobs);
    admin = await signIn(app, USERS.adminB);
    const roles = await admin.get('/api/v1/roles').expect(200);
    const agentRole = roles.body.data.find((r: { key: string }) => r.key === 'sales_agent').id;
    const team = await admin.post('/api/v1/teams').send({ name: 'B Sales' }).expect(201);
    teamId = team.body.id;
    for (const n of [1, 2, 3]) {
      const email = `agent${n}@b.ae`;
      const user = await admin.post('/api/v1/users').send({ email, fullName: `B Agent ${n}`, roleId: agentRole, teamId }).expect(201);
      const client = await signIn(app, { email, tenant: TENANT_B });
      await client.get('/api/v1/me').expect(200); // first login activates the invited user
      agents.push({ id: user.body.id, client });
    }
    sourceWeb = (await admin.post('/api/v1/lead-sources').send({ type: 'website', name: 'Website B' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const createLead = async (extra: Record<string, unknown> = {}) =>
    (await admin.post('/api/v1/leads').send({ fullName: 'Auto Lead', phonePrimary: nextPhone(), sourceId: SOURCE_META_B, ...extra }).expect(201)).body;

  describe('assignment rules', () => {
    it('with no matching rule a new lead goes to Unassigned', async () => {
      const lead = await createLead();
      expect(lead.ownerUserId).toBeNull();
    });

    it('round-robin across the team, skipping agents with lead assignment off', async () => {
      const rule = await admin.post('/api/v1/assignment-rules').send({ name: 'Meta to B Sales', conditions: { sourceIds: [SOURCE_META_B] }, targetTeamId: teamId }).expect(201);
      expect(rule.body).toMatchObject({ priority: 1, conditions: { sourceIds: [SOURCE_META_B] }, memberUserIds: [], isActive: true });
      const owners = [];
      for (let i = 0; i < 4; i++) owners.push((await createLead()).ownerUserId);
      expect(owners).toEqual([agents[0]!.id, agents[1]!.id, agents[2]!.id, agents[0]!.id]);

      await admin.put(`/api/v1/users/${agents[1]!.id}/receives-leads`).send({ receivesLeads: false }).expect(200);
      expect((await createLead()).ownerUserId).toBe(agents[2]!.id);
      expect((await createLead()).ownerUserId).toBe(agents[0]!.id);
      await admin.put(`/api/v1/users/${agents[1]!.id}/receives-leads`).send({ receivesLeads: true }).expect(200);

      const log = await ownerQuery<{ method: string; rule_id: string }>(
        `SELECT method, rule_id FROM lead_assignments WHERE tenant_id = $1 AND method = 'rule' ORDER BY changed_at DESC LIMIT 1`,
        [TENANT_B],
      );
      expect(log[0]).toMatchObject({ method: 'rule', rule_id: rule.body.id });
    });

    it('rules are checked top to bottom; members instead of a team; reorder and delete', async () => {
      const arabic = await admin
        .post('/api/v1/assignment-rules')
        .send({ name: 'Arabic speakers', priority: 1, conditions: { languages: ['ar'] }, memberUserIds: [agents[2]!.id] })
        .expect(201);
      const list = await admin.get('/api/v1/assignment-rules').expect(200);
      expect(list.body.data.map((r: { name: string; priority: number }) => [r.name, r.priority])).toEqual([
        ['Arabic speakers', 1],
        ['Meta to B Sales', 2],
      ]);
      expect((await createLead({ preferredLanguage: 'ar' })).ownerUserId).toBe(agents[2]!.id);
      expect((await createLead({ preferredLanguage: 'ar', sourceId: sourceWeb })).ownerUserId).toBe(agents[2]!.id);
      expect((await createLead({ sourceId: sourceWeb })).ownerUserId).toBeNull();

      await admin.post('/api/v1/assignment-rules').send({ name: 'No pool', conditions: {} }).expect(400);
      await admin.put('/api/v1/assignment-rules/order').send({ ruleIds: [arabic.body.id] }).expect(400);
      const ids = list.body.data.map((r: { id: string }) => r.id).reverse();
      await admin.put('/api/v1/assignment-rules/order').send({ ruleIds: ids }).expect(204);
      expect((await admin.get('/api/v1/assignment-rules').expect(200)).body.data[0].name).toBe('Meta to B Sales');

      await admin.patch(`/api/v1/assignment-rules/${arabic.body.id}`).send({ isActive: false }).expect(200);
      await agents[0]!.client.get('/api/v1/assignment-rules').expect(403);
    });
  });

  describe('rotation (Global Configuration › Leads, replaces the 10-minute rule)', () => {
    const expire = (leadId: string) => ownerQuery(`UPDATE leads SET response_due_at = now() - interval '1 minute' WHERE id = $1 AND response_due_at IS NOT NULL`, [leadId]);
    const owner = async (leadId: string) => (await admin.get(`/api/v1/leads/${leadId}`).expect(200)).body;
    let ruleId: string;
    const features = async (value: Record<string, unknown>) => {
      const current = (await admin.get('/api/v1/settings/leads.features').expect(200)).body.value;
      await admin.put('/api/v1/settings/leads.features').send({ value: { ...current, ...value } }).expect(200);
    };

    beforeAll(async () => {
      const rules = (await admin.get('/api/v1/assignment-rules').expect(200)).body.data as { id: string; name: string }[];
      ruleId = rules.find((r) => r.name === 'Meta to B Sales')!.id;
    });

    it('rules carry the shift, rotation minutes, maximum rotations and fallback; they are checked', async () => {
      const res = await admin.patch(`/api/v1/assignment-rules/${ruleId}`).send({ rotationMinutes: 15, maxRotations: 2, fallback: 'admin' }).expect(200);
      expect(res.body).toMatchObject({ shiftDays: [0, 1, 2, 3, 4, 5, 6], shiftStart: null, shiftEnd: null, timezone: null, rotationMinutes: 15, maxRotations: 2, fallback: 'admin' });
      await admin.patch(`/api/v1/assignment-rules/${ruleId}`).send({ shiftStart: '09:00' }).expect(400);
      await admin.patch(`/api/v1/assignment-rules/${ruleId}`).send({ fallback: 'user' }).expect(400);
      await admin.patch(`/api/v1/assignment-rules/${ruleId}`).send({ timezone: 'Mars/Base' }).expect(400);
      await admin.patch(`/api/v1/assignment-rules/${ruleId}`).send({ shiftDays: [] }).expect(400);
    });

    it('rotates to the next agent of the rule, up to the maximum, then the fallback takes the lead', async () => {
      const lead = await createLead();
      expect(lead.ownerUserId).not.toBeNull();
      expect(Date.parse(lead.responseDueAt) - Date.now()).toBeGreaterThan(14 * 60_000);

      await expire(lead.id);
      await jobs.responseTimer();
      const second = await owner(lead.id);
      expect(second.ownerUserId).not.toBe(lead.ownerUserId);
      expect(second.responseDueAt).not.toBeNull();

      await expire(lead.id);
      await jobs.responseTimer();
      const third = await owner(lead.id);
      expect([lead.ownerUserId, second.ownerUserId]).not.toContain(third.ownerUserId);

      await expire(lead.id);
      await jobs.responseTimer();
      expect(await owner(lead.id)).toMatchObject({ ownerUserId: USERS.adminB.id, responseDueAt: null });

      const log = await ownerQuery<{ method: string }>(`SELECT method FROM lead_assignments WHERE lead_id = $1 ORDER BY changed_at`, [lead.id]);
      expect(log.map((l) => l.method)).toEqual(['rule', 'no_response', 'no_response', 'admin_fallback']);
      const notes = await admin.get('/api/v1/notifications?unread=true').expect(200);
      expect(notes.body.data.map((n: { type: string }) => n.type)).toContain('lead_admin_fallback');
      const timeline = await admin.get(`/api/v1/leads/${lead.id}/timeline?types=owner_change`).expect(200);
      expect(timeline.body.data[0].summary).toMatch(/Rotation finished/);
    });

    it('fallback "unassigned" puts the lead back in the queue', async () => {
      await admin.patch(`/api/v1/assignment-rules/${ruleId}`).send({ maxRotations: 0, fallback: 'unassigned' }).expect(200);
      const lead = await createLead();
      await expire(lead.id);
      await jobs.responseTimer();
      expect(await owner(lead.id)).toMatchObject({ ownerUserId: null, responseDueAt: null });
    });

    it('a call logged by the owner in time stops the timer; a manual owner has no timer', async () => {
      const lead = await createLead();
      const agent = agents.find((a) => a.id === lead.ownerUserId)!;
      await agent.client.post(`/api/v1/leads/${lead.id}/calls`).send({ outcome: 'answered', note: 'Interested in 2BR' }).expect(201);
      await expire(lead.id); // no effect: the timer was already cleared
      await jobs.responseTimer();
      expect((await owner(lead.id)).ownerUserId).toBe(agent.id);
      expect((await createLead({ ownerUserId: agents[1]!.id })).responseDueAt).toBeNull();
    });

    it('outside the shift the rule does not assign, and an unanswered lead waits for the shift', async () => {
      const lead = await createLead();
      const today = new Date().getUTCDay();
      const tomorrow = (today + 1) % 7;
      await admin.patch(`/api/v1/assignment-rules/${ruleId}`).send({ shiftDays: [tomorrow], timezone: 'UTC' }).expect(200);
      expect((await createLead()).ownerUserId).toBeNull();
      await expire(lead.id);
      await jobs.responseTimer();
      const waiting = await owner(lead.id);
      expect(waiting.ownerUserId).toBe(lead.ownerUserId);
      expect(Date.parse(waiting.responseDueAt)).toBeGreaterThan(Date.now());
      await admin.patch(`/api/v1/assignment-rules/${ruleId}`).send({ shiftDays: [0, 1, 2, 3, 4, 5, 6], timezone: null, maxRotations: 3, fallback: 'admin' }).expect(200);
    });

    it('with Rotation off new leads stay Unassigned', async () => {
      await features({ rotation: false });
      expect((await createLead()).ownerUserId).toBeNull();
      await features({ rotation: true });
      expect((await createLead()).ownerUserId).not.toBeNull();
    });
  });

  describe('tasks and calls', () => {
    it("the lead's next follow-up follows its earliest open task; completing needs an outcome and a next action", async () => {
      const agent = agents[2]!;
      const lead = await createLead({ ownerUserId: agent.id });
      const task = await agent.client
        .post('/api/v1/tasks')
        .send({ leadId: lead.id, type: 'call', title: 'First call', dueAt: '2030-05-01T10:00:00Z', reminderMinutes: 15 })
        .expect(201);
      expect((await agent.client.get(`/api/v1/leads/${lead.id}`).expect(200)).body.nextFollowUpAt).toBe('2030-05-01T10:00:00.000Z');

      const noOutcome = await agent.client.post(`/api/v1/tasks/${task.body.id}/complete`).send({}).expect(422);
      expect(noOutcome.body.code).toBe('OUTCOME_REQUIRED');
      const noNext = await agent.client.post(`/api/v1/tasks/${task.body.id}/complete`).send({ outcome: 'busy' }).expect(422);
      expect(noNext.body.code).toBe('NEXT_ACTION_REQUIRED');

      const done = await agent.client
        .post(`/api/v1/tasks/${task.body.id}/complete`)
        .send({ outcome: 'busy', outcomeNote: 'Will call later', nextAction: { type: 'call', dueAt: '2030-05-02T09:00:00Z' } })
        .expect(200);
      expect(done.body.task).toMatchObject({ status: 'completed', outcome: 'busy' });
      expect(done.body.nextTask).toMatchObject({ type: 'call', status: 'open', dueAt: '2030-05-02T09:00:00.000Z' });
      const after = await agent.client.get(`/api/v1/leads/${lead.id}`).expect(200);
      expect(after.body).toMatchObject({ nextFollowUpAt: '2030-05-02T09:00:00.000Z', responseDueAt: null });
      const timeline = await agent.client.get(`/api/v1/leads/${lead.id}/timeline?types=call`).expect(200);
      expect(timeline.body.data[0].summary).toBe('Call: Busy');

      await agent.client.post(`/api/v1/tasks/${done.body.nextTask.id}/cancel`).expect(200);
      await agent.client.post(`/api/v1/tasks/${done.body.nextTask.id}/cancel`).expect(422);
    });

    it('agents see their own tasks; the Admin sees all; calendar views filter by date', async () => {
      const mine = await agents[0]!.client.get('/api/v1/tasks?limit=200').expect(200);
      expect(mine.body.data.every((t: { assignedUserId: string }) => t.assignedUserId === agents[0]!.id)).toBe(true);
      const all = await admin.get('/api/v1/tasks?limit=200').expect(200);
      expect(all.body.data.length).toBeGreaterThan(mine.body.data.length);
      const week = await admin.get('/api/v1/tasks?view=week&from=2030-05-01').expect(200);
      expect(week.body.data.every((t: { dueAt: string }) => t.dueAt >= '2030-05-01' && t.dueAt < '2030-05-08')).toBe(true);
      await agents[0]!.client.post('/api/v1/tasks').send({ type: 'personal', title: 'For someone else', dueAt: '2030-01-01T00:00:00Z', assignedUserId: agents[1]!.id }).expect(403);
      await agents[0]!.client.post('/api/v1/tasks').send({ type: 'call', title: 'No lead', dueAt: '2030-01-01T00:00:00Z' }).expect(400);
    });

    it('reminders before the due time and an overdue alert, each sent once', async () => {
      const agent = agents[0]!;
      const soon = new Date(Date.now() + 5 * 60_000).toISOString();
      const past = new Date(Date.now() - 5 * 60_000).toISOString();
      await agent.client.post('/api/v1/tasks').send({ type: 'personal', title: 'Soon', dueAt: soon, reminderMinutes: 10 }).expect(201);
      await agent.client.post('/api/v1/tasks').send({ type: 'personal', title: 'Late', dueAt: past }).expect(201);
      await jobs.reminders();
      await jobs.reminders();
      const notes = await agent.client.get('/api/v1/notifications?limit=200').expect(200);
      const titles = notes.body.data.map((n: { title: string }) => n.title);
      expect(titles.filter((t: string) => t === 'Reminder: Soon')).toHaveLength(1);
      expect(titles.filter((t: string) => t === 'Overdue: Late')).toHaveLength(1);
    });
  });

  describe('notifications', () => {
    it('lists own notifications, marks one or all as read; push devices register and unregister', async () => {
      const agent = agents[0]!;
      const unread = await agent.client.get('/api/v1/notifications?unread=true&limit=1').expect(200);
      expect(unread.body.data).toHaveLength(1);
      await agent.client.post(`/api/v1/notifications/${unread.body.data[0].id}/read`).expect(204);
      await agents[1]!.client.post(`/api/v1/notifications/${unread.body.data[0].id}/read`).expect(404);
      await agent.client.post('/api/v1/notifications/read-all').expect(204);
      expect((await agent.client.get('/api/v1/notifications?unread=true').expect(200)).body.data).toEqual([]);

      await agent.client.post('/api/v1/push-devices').send({ fcmToken: 'fcm-token-test-123456', platform: 'android' }).expect(204);
      await agent.client.delete('/api/v1/push-devices/fcm-token-test-123456').expect(204);
      await agent.client.delete('/api/v1/push-devices/fcm-token-test-123456').expect(404);
    });
  });
});
