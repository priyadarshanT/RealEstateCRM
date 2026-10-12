import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../core/events/domain-events';
import { LeadsService } from '../leads/leads.service';
import { SettingsService } from '../settings/settings.service';
import { ScoringStrategy, WeightedScoring } from './scoring.strategy';

/** Keeps each lead's score current: first score on creation, then on every change that affects it (architecture §3). */
@Injectable()
export class ScoringService implements OnModuleInit {
  private readonly strategy: ScoringStrategy = new WeightedScoring();

  constructor(
    private readonly leads: LeadsService,
    private readonly settings: SettingsService,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    const rescore = async (e: { leadId: string }) => {
      await this.rescore(e.leadId);
    };
    this.events.on('lead.created', rescore);
    this.events.on('lead.re_enquired', rescore);
    this.events.on('lead.stage_changed', rescore);
    this.events.on('lead.updated', rescore);
    this.events.on('lead.responded', rescore);
  }

  async rescore(leadId: string): Promise<number | undefined> {
    const facts = await this.leads.scoringFacts(leadId);
    if (!facts) return undefined;
    const weights = await this.settings.get('leads.scoring');
    const score = this.strategy.score(
      {
        stageCategory: facts.lead.stageCategory,
        hasBudgetMin: facts.lead.budgetMin !== null,
        hasBudgetMax: facts.lead.budgetMax !== null,
        projectCount: facts.projectCount,
        sourceQuality: facts.sourceQuality,
        enquiryCount: facts.lead.enquiryCount,
        answeredCalls: facts.answeredCalls,
        notes: facts.notes,
        inbound: facts.inbound,
        lastActivityAt: facts.lead.lastActivityAt,
      },
      weights,
    );
    if (score !== facts.lead.score) await this.leads.setScore(leadId, score);
    return score;
  }
}
