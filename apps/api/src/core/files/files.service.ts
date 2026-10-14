import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { WorkerDbService } from '../database/worker-db.service';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Database, DbService } from '../database/db.service';
import { ProblemException, Problems } from '../errors/problem';
import { RequestContext } from '../http/request-context';
import { DOWNLOAD_LINK_SECONDS, FILE_STORAGE, FileStorage } from './file-storage';
import { AttachmentCategory, AttachmentRow, attachments, FileRow, files } from './files.schema';

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // API guide §7: max 25 MB

const IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const DOCUMENTS = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];
export const UPLOAD_PURPOSES = {
  lead_attachment: [...DOCUMENTS, ...IMAGES],
  project_media: [...DOCUMENTS, ...IMAGES, 'video/mp4'],
  unit_floor_plan: ['application/pdf', ...IMAGES],
  finance: [...DOCUMENTS, ...IMAGES],
  attendance_photo: IMAGES,
  import: ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  message_media: [...DOCUMENTS, ...IMAGES, 'video/mp4', 'audio/ogg', 'audio/mpeg'],
  logo: IMAGES,
} as const;
export type UploadPurpose = keyof typeof UPLOAD_PURPOSES;

/** The record an attachment belongs to (attachments has exactly one of these set). */
export type AttachmentTarget =
  | { type: 'lead'; id: string }
  | { type: 'project'; id: string }
  | { type: 'unit'; id: string }
  | { type: 'deal'; id: string }
  | { type: 'finance_document'; id: string }
  | { type: 'commission'; id: string };
type TargetType = AttachmentTarget['type'];

/** Each module that owns attachable records says who may see and change its attachments. */
export interface AttachmentAccess {
  canView(recordId: string): Promise<boolean>;
  canEdit(recordId: string): Promise<boolean>;
}

const TARGET_COLUMN = {
  lead: attachments.leadId,
  project: attachments.projectId,
  unit: attachments.unitId,
  deal: attachments.dealId,
  finance_document: attachments.financeDocumentId,
  commission: attachments.commissionId,
} as const;
const TARGET_FIELD = {
  lead: 'leadId',
  project: 'projectId',
  unit: 'unitId',
  deal: 'dealId',
  finance_document: 'financeDocumentId',
  commission: 'commissionId',
} as const;

/** Files: upload and download links (S3), and attachments to records (architecture §3 "files"; API guide §7). */
@Injectable()
export class FilesService {
  private readonly access = new Map<TargetType, AttachmentAccess>();

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly workerDb: WorkerDbService,
  ) {}

  /** Worker: bytes stored per tenant (tenant usage for the owner console). */
  async storagePerTenant(): Promise<Map<string, number>> {
    const rows = await this.workerDb.db
      .select({ tenantId: files.tenantId, bytes: sql<string>`sum(${files.sizeBytes})::text` })
      .from(files)
      .where(isNull(files.deletedAt))
      .groupBy(files.tenantId);
    return new Map(rows.map((r) => [r.tenantId, Number(r.bytes)]));
  }

  registerAccess(type: TargetType, access: AttachmentAccess): void {
    this.access.set(type, access);
  }

  async requestUpload(input: { fileName: string; mimeType: string; sizeBytes: number; purpose: UploadPurpose }) {
    const allowed: readonly string[] = UPLOAD_PURPOSES[input.purpose];
    if (!allowed.includes(input.mimeType)) {
      throw new ProblemException(422, 'FILE_TYPE_NOT_ALLOWED', 'File type not allowed', `${input.mimeType} files cannot be uploaded here.`);
    }
    if (input.sizeBytes > MAX_FILE_BYTES) throw new ProblemException(422, 'FILE_TOO_LARGE', 'File too large', 'Files can be at most 25 MB.');
    const tenantId = this.db.currentTenantId!;
    const id = randomUUID();
    const storageKey = `${tenantId}/${input.purpose}/${id}/${safeName(input.fileName)}`;
    await this.db.current.insert(files).values({
      id,
      tenantId,
      storageKey,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedBy: RequestContext.get().userId ?? null,
    });
    const link = await this.storage.uploadLink(storageKey, input.mimeType, input.sizeBytes);
    return { fileId: id, uploadUrl: link.url, headers: link.headers };
  }

  /** The uploader confirms the upload; the stored size replaces the declared one. */
  async complete(fileId: string): Promise<{ fileId: string; sizeBytes: number }> {
    const file = await this.ownUpload(fileId);
    const size = await this.storage.size(file.storageKey);
    if (size === null) throw new ProblemException(422, 'FILE_NOT_UPLOADED', 'File not uploaded', 'Upload the file to the link first.');
    if (size > MAX_FILE_BYTES) throw new ProblemException(422, 'FILE_TOO_LARGE', 'File too large', 'Files can be at most 25 MB.');
    await this.db.current.update(files).set({ sizeBytes: size }).where(eq(files.id, fileId));
    return { fileId, sizeBytes: size };
  }

  async downloadLink(fileId: string): Promise<{ url: string; expiresAt: string }> {
    const file = await this.find(fileId);
    if (!file || !(await this.canSee(file))) throw Problems.notFound();
    return {
      url: await this.storage.downloadLink(file.storageKey, file.fileName),
      expiresAt: new Date(Date.now() + DOWNLOAD_LINK_SECONDS * 1000).toISOString(),
    };
  }

  /** A download link without the access check: the caller has already authorised it (e.g. billing.view for our invoices). */
  async systemDownloadLink(fileId: string): Promise<{ url: string; expiresAt: string }> {
    const file = await this.find(fileId);
    if (!file) throw Problems.notFound();
    return { url: await this.storage.downloadLink(file.storageKey, file.fileName), expiresAt: new Date(Date.now() + DOWNLOAD_LINK_SECONDS * 1000).toISOString() };
  }

  /** Links an uploaded file to a record. The caller (the owning module) has already checked edit access. */
  async attach(target: AttachmentTarget, fileId: string, category: AttachmentCategory, sortOrder = 0): Promise<AttachmentRow & { fileName: string }> {
    const file = await this.find(fileId);
    if (!file) throw Problems.validation([{ field: 'fileId', message: 'file not found' }]);
    if ((await this.storage.size(file.storageKey)) === null) {
      throw new ProblemException(422, 'FILE_NOT_UPLOADED', 'File not uploaded', 'Upload the file to the link first.');
    }
    const [row] = await this.db.current
      .insert(attachments)
      .values({ tenantId: this.db.currentTenantId!, fileId, category, sortOrder, [TARGET_FIELD[target.type]]: target.id, createdBy: RequestContext.get().userId ?? null })
      .returning();
    await this.audit.record('create', 'attachments', row!.id, { fileId: [null, fileId], [TARGET_FIELD[target.type]]: [null, target.id] });
    return { ...row!, fileName: file.fileName };
  }

  async listAttachments(target: AttachmentTarget): Promise<(AttachmentRow & { fileName: string })[]> {
    const rows = await this.db.current
      .select({ a: attachments, fileName: files.fileName })
      .from(attachments)
      .innerJoin(files, eq(files.id, attachments.fileId))
      .where(and(eq(TARGET_COLUMN[target.type], target.id), isNull(files.deletedAt)))
      .orderBy(asc(attachments.sortOrder), asc(attachments.createdAt));
    return rows.map((r) => ({ ...r.a, fileName: r.fileName }));
  }

  /** DELETE /attachments/{id}: needs edit access to the record the file is attached to. */
  async removeAttachment(id: string): Promise<{ target: AttachmentTarget; fileId: string }> {
    const [row] = await this.db.current.select().from(attachments).where(eq(attachments.id, id)).limit(1);
    if (!row) throw Problems.notFound();
    const target = targetOf(row);
    const access = this.access.get(target.type);
    if (!access || !(await access.canView(target.id))) throw Problems.notFound();
    if (!(await access.canEdit(target.id))) throw Problems.forbidden();
    await this.db.current.delete(attachments).where(eq(attachments.id, id));
    await this.audit.record('delete', 'attachments', id, { fileId: [row.fileId, null] });
    return { target, fileId: row.fileId };
  }

  /** Reads a stored file (imports). Only the uploader's own unattached files or files the user may see. */
  async read(fileId: string): Promise<{ file: FileRow; body: Buffer }> {
    const file = await this.find(fileId);
    if (!file || !(await this.canSee(file))) throw Problems.validation([{ field: 'fileId', message: 'file not found' }]);
    return { file, body: await this.storage.read(file.storageKey) };
  }

  /** Reads a stored file for a background job (no signed-in user; the caller owns the record that points to it). */
  async readSystem(fileId: string): Promise<{ file: FileRow; body: Buffer }> {
    const file = await this.find(fileId);
    if (!file) throw new Error(`file ${fileId} not found`);
    return { file, body: await this.storage.read(file.storageKey) };
  }

  /** Saves a file the system generated (exports, rejected import rows). */
  /** `ownerUserId`: who may download it (e.g. the user who started an import or export). */
  /** `via`: save the file row through another connection (e.g. the platform one) so that connection can link it at once. */
  async store(fileName: string, mimeType: string, body: Buffer, purpose: string, ownerUserId?: string, via?: { db: Database; tenantId: string }): Promise<FileRow> {
    const tenantId = via?.tenantId ?? this.db.currentTenantId!;
    const id = randomUUID();
    const storageKey = `${tenantId}/${purpose}/${id}/${safeName(fileName)}`;
    await this.storage.write(storageKey, body, mimeType);
    const [row] = await (via?.db ?? this.db.current)
      .insert(files)
      .values({ id, tenantId, storageKey, fileName, mimeType, sizeBytes: body.length, uploadedBy: ownerUserId ?? RequestContext.get().userId ?? null })
      .returning();
    return row!;
  }

  private async find(fileId: string): Promise<FileRow | undefined> {
    const [row] = await this.db.current.select().from(files).where(and(eq(files.id, fileId), isNull(files.deletedAt))).limit(1);
    return row;
  }

  private async ownUpload(fileId: string): Promise<FileRow> {
    const file = await this.find(fileId);
    if (!file || file.uploadedBy !== RequestContext.get().userId) throw Problems.notFound();
    return file;
  }

  /** The uploader always; otherwise anyone who can see a record the file is attached to. */
  private async canSee(file: FileRow): Promise<boolean> {
    if (file.uploadedBy && file.uploadedBy === RequestContext.get().userId) return true;
    const links = await this.db.current.select().from(attachments).where(eq(attachments.fileId, file.id));
    for (const link of links) {
      const target = targetOf(link);
      if (await this.access.get(target.type)?.canView(target.id)) return true;
    }
    return false;
  }
}

function targetOf(row: AttachmentRow): AttachmentTarget {
  for (const type of Object.keys(TARGET_FIELD) as TargetType[]) {
    const id = row[TARGET_FIELD[type]];
    if (id) return { type, id } as AttachmentTarget;
  }
  throw new Error(`attachment ${row.id} has no record`);
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(-120) || 'file';
}
