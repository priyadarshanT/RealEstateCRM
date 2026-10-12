import { Injectable } from '@nestjs/common';
import { MarketingService } from '../marketing/marketing.service';
import { OrganizationDirectory } from '../organization/directory.service';
import { LeadConfigService } from '../settings/lead-config.service';

/** Display names for IDs in charts and reports (sources, stages, agents, campaigns, reasons). */
@Injectable()
export class LabelsService {
  constructor(
    private readonly config: LeadConfigService,
    private readonly directory: OrganizationDirectory,
    private readonly marketing: MarketingService,
  ) {}

  async sources(ids: string[]): Promise<Map<string, string>> {
    return this.each(ids, async (id) => (await this.config.getSource(id)).name);
  }

  async stages(ids: string[]): Promise<Map<string, string>> {
    return this.each(ids, async (id) => (await this.config.getStage(id)).name);
  }

  async reasons(ids: string[]): Promise<Map<string, string>> {
    return this.each(ids, async (id) => (await this.config.getReason(id)).name);
  }

  async users(ids: string[]): Promise<Map<string, string>> {
    const users = await this.directory.users(ids.filter(Boolean));
    return new Map([...users].map(([id, u]) => [id, u.fullName]));
  }

  async campaigns(ids: string[]): Promise<Map<string, string>> {
    return this.marketing.names([...new Set(ids.filter(Boolean))]);
  }

  private async each(ids: string[], name: (id: string) => Promise<string>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    const pairs = await Promise.all(unique.map(async (id) => [id, await name(id).catch(() => id)] as const));
    return new Map(pairs);
  }
}
