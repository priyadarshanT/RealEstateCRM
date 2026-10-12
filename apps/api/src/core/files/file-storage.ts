import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Object storage adapter (Amazon S3 in AWS; MinIO locally, which speaks the same API). */
export interface FileStorage {
  /** Link the browser PUTs the file to (10 minutes). */
  uploadLink(key: string, mimeType: string, sizeBytes: number): Promise<{ url: string; headers: Record<string, string> }>;
  /** Link to download the file (5 minutes). */
  downloadLink(key: string, fileName: string): Promise<string>;
  /** Size of a stored object, or null when it was never uploaded. */
  size(key: string): Promise<number | null>;
  read(key: string): Promise<Buffer>;
  write(key: string, body: Buffer, mimeType: string): Promise<void>;
}
export const FILE_STORAGE = Symbol('FILE_STORAGE');

export const UPLOAD_LINK_SECONDS = 10 * 60;
export const DOWNLOAD_LINK_SECONDS = 5 * 60;

export interface S3Settings {
  bucket: string;
  region: string;
  endpoint?: string;
}

export class S3FileStorage implements FileStorage {
  private readonly s3: S3Client;

  constructor(private readonly settings: S3Settings) {
    this.s3 = new S3Client({ region: settings.region, endpoint: settings.endpoint, forcePathStyle: Boolean(settings.endpoint) });
  }

  async uploadLink(key: string, mimeType: string, sizeBytes: number) {
    const command = new PutObjectCommand({ Bucket: this.settings.bucket, Key: key, ContentType: mimeType, ContentLength: sizeBytes });
    return { url: await getSignedUrl(this.s3, command, { expiresIn: UPLOAD_LINK_SECONDS }), headers: { 'Content-Type': mimeType } };
  }

  async downloadLink(key: string, fileName: string) {
    const disposition = `attachment; filename="${fileName.replace(/["\\\r\n]/g, '_')}"`;
    const command = new GetObjectCommand({ Bucket: this.settings.bucket, Key: key, ResponseContentDisposition: disposition });
    return getSignedUrl(this.s3, command, { expiresIn: DOWNLOAD_LINK_SECONDS });
  }

  async size(key: string) {
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.settings.bucket, Key: key }));
      return head.ContentLength ?? 0;
    } catch (err) {
      if ((err as { name?: string }).name === 'NotFound') return null;
      throw err;
    }
  }

  async read(key: string) {
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }));
    return Buffer.from(await object.Body!.transformToByteArray());
  }

  async write(key: string, body: Buffer, mimeType: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.settings.bucket, Key: key, Body: body, ContentType: mimeType }));
  }
}

/** In-memory storage for automated tests. Links are fake; tests put bytes in with write(). */
export class MemoryFileStorage implements FileStorage {
  readonly objects = new Map<string, { body: Buffer; mimeType: string }>();

  async uploadLink(key: string, mimeType: string) {
    return { url: `memory://upload/${key}`, headers: { 'Content-Type': mimeType } };
  }

  async downloadLink(key: string) {
    return `memory://download/${key}`;
  }

  async size(key: string) {
    return this.objects.get(key)?.body.length ?? null;
  }

  async read(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error(`no object ${key}`);
    return object.body;
  }

  async write(key: string, body: Buffer, mimeType: string) {
    this.objects.set(key, { body, mimeType });
  }
}
