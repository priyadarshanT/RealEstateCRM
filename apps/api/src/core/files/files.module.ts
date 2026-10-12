import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { FILE_STORAGE, FileStorage, S3FileStorage } from './file-storage';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

/** Storage is S3 when S3_BUCKET is set; a call without it fails clearly instead of silently losing files. */
function storageFrom(config: AppConfig): FileStorage {
  if (config.S3_BUCKET) return new S3FileStorage({ bucket: config.S3_BUCKET, region: config.S3_REGION, endpoint: config.S3_ENDPOINT });
  const missing = async (): Promise<never> => {
    throw new Error('File storage is not configured: set S3_BUCKET (and S3_ENDPOINT for local MinIO)');
  };
  return { uploadLink: missing, downloadLink: missing, size: missing, read: missing, write: missing };
}

@Global()
@Module({
  controllers: [FilesController],
  providers: [{ provide: FILE_STORAGE, inject: [APP_CONFIG], useFactory: storageFrom }, FilesService],
  exports: [FilesService, FILE_STORAGE],
})
export class FilesModule {}
