import { Global, Module } from '@nestjs/common';
import { PlatformAuthGuard } from '../auth/platform-auth';
import { PlatformDbService } from './platform-db.service';

@Global()
@Module({ providers: [PlatformDbService, PlatformAuthGuard], exports: [PlatformDbService, PlatformAuthGuard] })
export class PlatformDbModule {}
