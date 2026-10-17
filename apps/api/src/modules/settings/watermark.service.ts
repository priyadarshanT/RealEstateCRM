import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DbService } from '../../core/database/db.service';
import { FilesService } from '../../core/files/files.service';
import { AttachmentCategory, FileRow } from '../../core/files/files.schema';
import { OrganizationService } from '../organization/organization.service';
import { SettingsService } from './settings.service';
import { WATERMARK_IMAGE_TYPES, watermarkImage, watermarkPdf } from './watermark';

/** Watermark "apply to" choices → attachment categories. */
const CATEGORIES: Record<string, AttachmentCategory[]> = {
  brochures: ['brochure'],
  floor_plans: ['floor_plan'],
  images: ['image'],
  documents: ['document', 'contract'],
};

/**
 * Applies the company watermark when a file is downloaded (Global Configuration › General › Watermark): images
 * and PDFs attached as one of the chosen kinds get the text or logo. The original stays untouched; each
 * watermarked copy is made once per watermark setting and then served from storage.
 */
@Injectable()
export class WatermarkService implements OnModuleInit {
  private readonly logger = new Logger(WatermarkService.name);

  constructor(
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly organization: OrganizationService,
    private readonly db: DbService,
  ) {}

  onModuleInit(): void {
    this.files.registerDownloadTransform({ plan: (file, categories) => this.plan(file, categories) });
  }

  private async plan(file: FileRow, categories: AttachmentCategory[]) {
    const isImage = WATERMARK_IMAGE_TYPES.includes(file.mimeType);
    if (!isImage && file.mimeType !== 'application/pdf') return undefined;
    const { watermark: w } = await this.settings.get('general.preferences');
    if (!w.enabled) return undefined;
    const wanted = new Set(w.apply_to.flatMap((k) => CATEGORIES[k] ?? []));
    if (!categories.some((c) => wanted.has(c))) return undefined;

    let logo: Buffer | undefined;
    let logoId: string | null = null;
    if (w.kind === 'logo') {
      logoId = (await this.organization.getProfile(this.db.currentTenantId!)).logoFileId;
      if (!logoId) return undefined; // no logo uploaded yet: nothing to stamp
      logo = (await this.files.readSystem(logoId)).body;
    }
    const style = { kind: w.kind, text: w.text, opacity: w.opacity, position: w.position, ...(logo ? { logo } : {}) };
    const version = createHash('sha256').update(JSON.stringify({ ...style, logo: logoId })).digest('hex').slice(0, 16);
    return {
      version,
      apply: async (body: Buffer) => {
        try {
          return isImage ? await watermarkImage(body, file.mimeType, style) : await watermarkPdf(body, style);
        } catch (err) {
          // A file the library cannot read is served as it is rather than not at all.
          this.logger.warn(`watermark skipped for file ${file.id}: ${(err as Error).message}`);
          return body;
        }
      },
    };
  }
}
