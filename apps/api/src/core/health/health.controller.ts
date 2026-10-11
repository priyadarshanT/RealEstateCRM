import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { DbService } from '../database/db.service';

/** Load-balancer / uptime check at /health (outside /api/v1 and not part of the API contract). */
@ApiExcludeController()
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.db.ping();
    } catch {
      throw new ServiceUnavailableException('Database is not reachable');
    }
    return { status: 'ok' };
  }
}
