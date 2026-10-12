import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { QueueService } from '../src/core/queue/queue.service';
import { createTestApp, signIn, testStorage, USERS } from './helpers';

type Client = Awaited<ReturnType<typeof signIn>>;

const SOURCE_META_A = 'a1000000-0000-0000-0000-000000000001';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Excel / CSV import (SRS §2.4; API guide §11a): upload → preview → confirm → background import → status.
describe('lead import', () => {
  let app: INestApplication;
  let admin: Client;
  let agent: Client;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await signIn(app, USERS.adminA);
    agent = await signIn(app, USERS.aliA);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Uploads like the browser does: request a link, PUT the bytes (here: into the test storage), confirm. */
  async function upload(client: Client, fileName: string, mimeType: string, body: Buffer): Promise<string> {
    const ticket = await client.post('/api/v1/files/uploads').send({ fileName, mimeType, sizeBytes: body.length, purpose: 'import' }).expect(201);
    await testStorage.write(ticket.body.uploadUrl.replace('memory://upload/', ''), body, mimeType);
    await client.post(`/api/v1/files/${ticket.body.fileId}/complete`).expect(200);
    return ticket.body.fileId;
  }

  it('uploads are checked for type and size', async () => {
    const bad = await admin.post('/api/v1/files/uploads').send({ fileName: 'x.exe', mimeType: 'application/x-msdownload', sizeBytes: 10, purpose: 'import' }).expect(422);
    expect(bad.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    const big = await admin.post('/api/v1/files/uploads').send({ fileName: 'x.csv', mimeType: 'text/csv', sizeBytes: 30 * 1024 * 1024, purpose: 'import' }).expect(422);
    expect(big.body.code).toBe('FILE_TOO_LARGE');
    const ticket = await admin.post('/api/v1/files/uploads').send({ fileName: 'x.csv', mimeType: 'text/csv', sizeBytes: 10, purpose: 'import' }).expect(201);
    const notYet = await admin.post(`/api/v1/files/${ticket.body.fileId}/complete`).expect(422);
    expect(notYet.body.code).toBe('FILE_NOT_UPLOADED');
  });

  it('CSV: preview checks phone and email; the import creates leads, re-enquiries and a rejected-rows file', async () => {
    const csv = [
      'Name,Mobile,Email,Budget,Notes',
      'Rahul Mehta,+971 55 700 0001,rahul@x.in,1500000,Wants 2BR',
      'Ahmed,00971501234567,,,',
      'No Contact,,,,',
      'Bad Phone,0501234,,,',
      'Lina,,lina@x.ae,,',
    ].join('\n');
    const fileId = await upload(admin, 'leads.csv', 'text/csv', Buffer.from(csv));
    await agent.post('/api/v1/leads/imports').send({ fileId, sourceId: SOURCE_META_A }).expect(403);

    const started = await admin.post('/api/v1/leads/imports').send({ fileId, sourceId: SOURCE_META_A }).expect(201);
    expect(started.body).toMatchObject({ status: 'previewing', rowsTotal: 5, mapping: { fullName: 'Name', phone: 'Mobile', email: 'Email', budgetMax: 'Budget', note: 'Notes' } });
    expect(started.body.preview.map((r: { status: string }) => r.status)).toEqual(['ok', 'ok', 'rejected', 'rejected', 'ok']);
    expect(started.body.preview[3].errors).toEqual(['invalid phone "0501234"']);

    const confirmed = await admin.post(`/api/v1/leads/imports/${started.body.id}/confirm`).expect(202);
    expect(confirmed.body.status).toBe('importing');
    await admin.post(`/api/v1/leads/imports/${started.body.id}/confirm`).expect(409);
    expect(await app.get(QueueService).drain('lead-import')).toBe(1);

    const done = await admin.get(`/api/v1/leads/imports/${started.body.id}`).expect(200);
    expect(done.body).toMatchObject({ status: 'completed', rowsImported: 2, rowsReEnquired: 1, rowsRejected: 2, rejectedRowsFileId: expect.any(String) });
    const link = await admin.get(`/api/v1/files/${done.body.rejectedRowsFileId}/download`).expect(200);
    const rejected = (await testStorage.read(link.body.url.replace('memory://download/', ''))).toString('utf8');
    expect(rejected).toContain('no phone or email');

    const rahul = await admin.get('/api/v1/leads?q=Rahul').expect(200);
    expect(rahul.body.data[0]).toMatchObject({ fullName: 'Rahul Mehta', phonePrimary: '+971557000001', budgetMax: '1500000.00', budgetCurrency: 'AED', latestNote: 'Wants 2BR' });
    const notes = await admin.get('/api/v1/notifications?limit=5').expect(200);
    expect(notes.body.data.map((n: { type: string }) => n.type)).toContain('import_completed');
  });

  it('XLSX with an explicit mapping; Excel numbers keep every digit and get the + back', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Leads');
    sheet.addRow(['Client', 'Phone No', 'Lead ID']);
    sheet.addRow(['Omar Saeed', 971557000002, 'SHEET-1']);
    const body = Buffer.from(await workbook.xlsx.writeBuffer());
    const fileId = await upload(admin, 'leads.xlsx', XLSX, body);

    const bad = await admin.post('/api/v1/leads/imports').send({ fileId, sourceId: SOURCE_META_A, mapping: { fullName: 'Missing column' } }).expect(400);
    expect(bad.body.errors[0].message).toMatch(/no column/);
    const started = await admin
      .post('/api/v1/leads/imports')
      .send({ fileId, sourceId: SOURCE_META_A, mapping: { fullName: 'Client', phone: 'Phone No', externalSubmissionId: 'Lead ID' } })
      .expect(201);
    await admin.post(`/api/v1/leads/imports/${started.body.id}/confirm`).expect(202);
    await app.get(QueueService).drain('lead-import');
    const done = await admin.get(`/api/v1/leads/imports/${started.body.id}`).expect(200);
    expect(done.body).toMatchObject({ status: 'completed', rowsImported: 1, rowsRejected: 0 });
    const omar = await admin.get('/api/v1/leads?q=Omar%20Saeed').expect(200);
    expect(omar.body.data[0].phonePrimary).toBe('+971557000002');
    const inquiries = await admin.get(`/api/v1/leads/${omar.body.data[0].id}/inquiries`).expect(200);
    expect(inquiries.body.data[0]).toMatchObject({ externalSubmissionId: 'SHEET-1', formAnswers: { Client: 'Omar Saeed' } });
  });
});
