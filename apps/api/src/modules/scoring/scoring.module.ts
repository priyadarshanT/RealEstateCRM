import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { SettingsModule } from '../settings/settings.module';
import { ScoringService } from './scoring.service';

/** Lead score 0–100, best leads first (SRS §2.24). */
@Module({
  imports: [LeadsModule, SettingsModule],
  providers: [ScoringService],
  exports: [ScoringService],
})
export class ScoringModule {}
