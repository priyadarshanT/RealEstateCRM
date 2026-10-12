import { Module } from '@nestjs/common';
import { CampaignsController } from './marketing.controller';
import { MarketingService } from './marketing.service';

/** Ad campaigns and daily ad spend (SRS §8.3). */
@Module({ controllers: [CampaignsController], providers: [MarketingService], exports: [MarketingService] })
export class MarketingModule {}
