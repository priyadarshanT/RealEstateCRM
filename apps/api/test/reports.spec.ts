import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { QueueService } from '../src/core/queue/queue.service';
import { createTestApp, ownerQuery, signIn, testStorage, TENANT_B, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

// Dashboard (SRS §10) and reports and exports (SRS §8). Data is created in tenant B under its own source,
// and every figure is filtered by that source, so other test files do not change the numbers.
describe('dashboard, reports, exports', () => {
  let app: INestApplication;
  let admin: Client;
  let agentA: Client;
  let sourceId: string;
  let campaignId: string;
  let stage: Record<string, string>;
  let reason: Record<string, string>;
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signIn(app, USERS.adminB);
    agentA = await signIn(app, USERS.aliA);
    sourceId = (await admin.post('/api/v1/lead-sources').send({ type: 'website', name: 'Reports source', qualityScore: 80 }).expect(201)).body.id;
    campaignId = (await admin.post('/api/v1/campaigns').send({ sourceId, name: 'Reports campaign' }).expect(201)).body.id;
    await admin.put(`/api/v1/campaigns/${campaignId}/spend`).send({ days: [{ spendDate: today, amount: '300.00', currency: 'AED' }] }).expect(204);
    stage = Object.fromEntries((await admin.get('/api/v1/lead-stages?limit=200').expect(200)).body.data.map((s: { key: string; id: string }) => [s.key, s.id]));
    reason = Object.fromEntries((await admin.get('/api/v1/reasons?type=lost').expect(200)).body.data.map((r: { name: string; id: string }) => [r.name, r.id]));

    // 3 leads from the campaign: one qualified, one lost, one new.
    const make = async (n: number) =>
      (await admin.post('/api/v1/leads').send({ fullName: `Report Lead ${n}`, phonePrimary: `+9715577000${n}0`, sourceId, campaignId, ownerUserId: USERS.adminB.id }).expect(201)).body;
    const [a, b] = [await make(1), await make(2), await make(3)];
    await admin.post(`/api/v1/leads/${a.id}/stage`).send({ stageId: stage.qualified, nextFollowUpAt: '2030-01-01T00:00:00Z' }).expect(200);
    await admin.post(`/api/v1/leads/${b.id}/stage`).send({ stageId: stage.lost, reasonId: reason['Not interested'] }).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('dashboard: cards, buckets with drill-down filters, funnel and trend', async () => {
    const res = await admin.get(`/api/v1/dashboard?sourceId=${sourceId}&from=${today}&to=${today}`).expect(200);
    expect(res.body.kpis).toMatchObject({ total: 3, new: 1, qualified: 1, salesValue: '0.00', unpaidInvoices: '0.00' });
    expect(res.body.bySource).toEqual([{ key: sourceId, label: 'Reports source', count: 3, drillDown: { createdFrom: today, createdTo: today, sourceId } }]);
    expect(res.body.byCampaign[0]).toMatchObject({ key: campaignId, label: 'Reports campaign', count: 3 });
    const lostBucket = res.body.byStage.find((b: { key: string }) => b.key === stage.lost);
    expect(lostBucket).toMatchObject({ label: 'Lost', count: 1, drillDown: { stageId: stage.lost, sourceId } });
    expect(res.body.funnel.map((s: { key: string; count: number }) => [s.key, s.count])).toEqual([
      ['lead', 3],
      ['contacted', 1],
      ['qualified', 1],
      ['meeting', 0],
      ['eoi', 0],
      ['booking', 0],
      ['sale', 0],
    ]);
    expect(res.body.trend).toEqual([{ date: today, leads: 3, qualified: 1, spend: '300.00', sales: '0.00' }]);

    // The drill-down opens exactly the leads behind the number.
    const drilled = await admin.get(`/api/v1/leads?${new URLSearchParams(lostBucket.drillDown)}`).expect(200);
    expect(drilled.body.data).toHaveLength(1);
    await admin.get(`/api/v1/dashboard?from=${today}&to=2020-01-01`).expect(400);
  });

  it('the dashboard follows the data scope: an agent only counts their own leads', async () => {
    const res = await agentA.get('/api/v1/dashboard').expect(200);
    const mine = await agentA.get('/api/v1/leads?tab=all&limit=200&total=true').expect(200);
    expect(res.body.kpis.total).toBe(mine.body.page.total);
  });

  it('reports: list, lead lists with paging and totals, breakdowns, marketing cost per lead, funnel', async () => {
    const list = await admin.get('/api/v1/reports').expect(200);
    expect(list.body.data.map((r: { key: string }) => r.key)).toEqual(
      expect.arrayContaining(['leads', 'leads_lost', 're_enquiries', 'leads_by_source', 'marketing', 'agent_performance', 'call_outcomes', 'funnel', 'events']),
    );

    const page1 = await admin.get(`/api/v1/reports/leads?sourceId=${sourceId}&limit=2`).expect(200);
    expect(page1.body).toMatchObject({ totals: { leads: 3 }, page: { hasMore: true, total: 3 } });
    expect(page1.body.rows[0]).toMatchObject({ source: 'Reports source', campaign: 'Reports campaign', agent: 'Admin B' });
    const page2 = await admin.get(`/api/v1/reports/leads?sourceId=${sourceId}&limit=2&cursor=${page1.body.page.nextCursor}`).expect(200);
    expect(page2.body.rows).toHaveLength(1);

    const lost = await admin.get(`/api/v1/reports/leads_lost?sourceId=${sourceId}`).expect(200);
    expect(lost.body.rows).toEqual([expect.objectContaining({ stage: 'Lost', reason: 'Not interested' })]);

    const marketing = await admin.get(`/api/v1/reports/marketing?campaignId=${campaignId}&from=${today}&to=${today}`).expect(200);
    expect(marketing.body.rows).toEqual([
      { campaignId, campaign: 'Reports campaign', leads: 3, qualified: 1, spend: '300.00', costPerLead: '100.00', costPerQualified: '300.00' },
    ]);
    const funnel = await admin.get(`/api/v1/reports/funnel?sourceId=${sourceId}`).expect(200);
    expect(funnel.body.rows[2]).toMatchObject({ step: 'Qualified', leads: 1, conversion: 100 });
    await admin.get('/api/v1/reports/no_such_report').expect(404);
  });

  it('exports: Admin only, run in the background, totals match the screen, logged', async () => {
    await agentA.post('/api/v1/reports/leads/exports').send({ format: 'csv' }).expect(403);
    await admin.post('/api/v1/reports/leads/exports').send({ format: 'csv', filters: { password: 'x' } }).expect(400);

    const csv = await admin.post('/api/v1/reports/leads/exports').send({ format: 'csv', filters: { sourceId } }).expect(202);
    const xlsx = await admin.post('/api/v1/reports/marketing/exports').send({ format: 'xlsx', filters: { campaignId, from: today, to: today } }).expect(202);
    expect(csv.body).toMatchObject({ status: 'queued', reportKey: 'leads', downloadUrl: null });
    expect(await app.get(QueueService).drain('report-export')).toBe(2);

    const done = await admin.get(`/api/v1/exports/${csv.body.id}`).expect(200);
    expect(done.body).toMatchObject({ status: 'completed', rowCount: 3, downloadUrl: expect.stringContaining('memory://download/') });
    const text = (await testStorage.read(done.body.downloadUrl.replace('memory://download/', ''))).toString('utf8');
    const lines = text.trim().split(/\r\n/);
    expect(lines[0]).toContain('Name,Phone,Email,Source');
    expect(lines).toHaveLength(5); // header, 3 rows, total
    expect(lines[4]).toMatch(/^Total,/);

    const sheetLink = (await admin.get(`/api/v1/exports/${xlsx.body.id}`).expect(200)).body.downloadUrl;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await testStorage.read(sheetLink.replace('memory://download/', ''))) as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getRow(2).values).toEqual([undefined, 'Reports campaign', 3, 1, 300, 100, 300]);
    expect(sheet.getRow(3).getCell(1).value).toBe('Total');

    const log = await admin.get('/api/v1/exports').expect(200);
    expect(log.body.data.slice(0, 2).map((e: { reportKey: string }) => e.reportKey).sort()).toEqual(['leads', 'marketing']);
    const notes = await admin.get('/api/v1/notifications?limit=5').expect(200);
    expect(notes.body.data.map((n: { type: string }) => n.type)).toContain('export_ready');
    await agentA.get(`/api/v1/exports/${csv.body.id}`).expect(404);
  });

  it('Phase 2 reports: WhatsApp / email campaign results and integration failures (SRS §8.6)', async () => {
    // A connection with 2 imported, 1 retrying and 1 failed event, and a sent campaign with mixed results.
    const APPROVER = { id: 'b0000000-0000-0000-0000-0000000000f1', email: 'report.approver@b.ae' };
    await ownerQuery(
      `INSERT INTO users (id, tenant_id, email, full_name, role_id, status)
       SELECT $1, $2, $3, 'Report Approver', id, 'active' FROM roles WHERE tenant_id = $2 AND key = 'sales_agent' ON CONFLICT (id) DO NOTHING`,
      [APPROVER.id, TENANT_B, APPROVER.email],
    );
    const [integration] = await ownerQuery<{ id: string }>(
      `INSERT INTO integrations (tenant_id, provider, account_label, external_account_id, status, settings, last_error, last_error_at)
       VALUES ($1, 'webhook', 'Reports sheet', 'whk_reports_spec', 'connected', '{}', 'Not imported: a phone or an email is required', now()) RETURNING id`,
      [TENANT_B],
    );
    for (const [n, status, attempts] of [[1, 'processed', 1], [2, 'processed', 1], [3, 'received', 2], [4, 'failed', 5]] as const) {
      await ownerQuery(`INSERT INTO webhook_events (tenant_id, integration_id, provider, external_event_id, signature_valid, payload, status, attempts) VALUES ($1, $2, 'webhook', $3, true, '{}', $4, $5)`, [
        TENANT_B,
        integration!.id,
        `reports-spec-${n}`,
        status,
        attempts,
      ]);
    }
    const [template] = await ownerQuery<{ id: string }>(`INSERT INTO message_templates (tenant_id, channel, name, category, body, status) VALUES ($1, 'whatsapp', 'reports_spec_promo', 'marketing', 'Hi', 'approved') RETURNING id`, [TENANT_B]);
    const [campaign] = await ownerQuery<{ id: string }>(
      `INSERT INTO message_campaigns (tenant_id, name, channel, template_id, integration_id, audience_filter, status, created_by, approved_by, approved_at, started_at, completed_at)
       VALUES ($1, 'Reports spec blast', 'whatsapp', $2, $3, '{}', 'completed', $4, $5, now(), now(), now()) RETURNING id`,
      [TENANT_B, template!.id, integration!.id, USERS.adminB.id, APPROVER.id],
    );
    const leads = (await admin.get(`/api/v1/leads?sourceId=${sourceId}`).expect(200)).body.data as { id: string; phonePrimary: string }[];
    for (const [i, status] of ['delivered', 'replied', 'failed'].entries()) {
      await ownerQuery(`INSERT INTO message_campaign_recipients (tenant_id, campaign_id, lead_id, address, status) VALUES ($1, $2, $3, $4, $5)`, [TENANT_B, campaign!.id, leads[i]!.id, leads[i]!.phonePrimary, status]);
    }

    const list = (await admin.get('/api/v1/reports').expect(200)).body.data.map((r: { key: string }) => r.key);
    expect(list).toEqual(expect.arrayContaining(['message_campaigns', 'integration_failures']));
    const agentList = (await agentA.get('/api/v1/reports').expect(200)).body.data.map((r: { key: string }) => r.key);
    expect(agentList).not.toContain('integration_failures');
    await agentA.get('/api/v1/reports/integration_failures').expect(403);

    const campaigns = (await admin.get(`/api/v1/reports/message_campaigns?from=${today}&to=${today}`).expect(200)).body;
    expect(campaigns.rows.find((r: { campaign: string }) => r.campaign === 'Reports spec blast')).toMatchObject({
      channel: 'WhatsApp',
      audience: 3,
      sent: 2,
      delivered: 2,
      failed: 1,
      replied: 1,
      optedOut: 0,
      deliveryRate: 100,
    });
    expect((await admin.get('/api/v1/reports/message_campaigns?from=2020-01-01&to=2020-01-31').expect(200)).body.rows).toEqual([]);

    const failures = (await admin.get(`/api/v1/reports/integration_failures?from=${today}&to=${today}`).expect(200)).body;
    expect(failures.rows.find((r: { integrationId: string }) => r.integrationId === integration!.id)).toMatchObject({
      connection: 'General webhook',
      account: 'Reports sheet',
      received: 4,
      processed: 2,
      retrying: 1,
      failed: 1,
      lastError: 'Not imported: a phone or an email is required',
    });
  });
});
