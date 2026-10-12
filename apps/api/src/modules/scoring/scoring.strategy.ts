/** Inputs of a lead score. */
export interface ScoreFacts {
  stageCategory: 'open' | 'won' | 'lost' | 'invalid';
  hasBudgetMin: boolean;
  hasBudgetMax: boolean;
  projectCount: number;
  sourceQuality: number;
  enquiryCount: number;
  answeredCalls: number;
  notes: number;
  inbound: number;
  lastActivityAt: Date | null;
}

/** Weights from the tenant setting leads.scoring (they add up to 100). */
export interface ScoreWeights {
  budget_fit: number;
  project_match: number;
  source_quality: number;
  engagement: number;
}

/** Scoring strategy (architecture: strategy pattern), so the formula can change without touching callers. */
export interface ScoringStrategy {
  score(facts: ScoreFacts, weights: ScoreWeights): number;
}

/**
 * Lead score 0–100 (SRS §2.24): each part is rated 0–100 and weighted by the tenant's settings.
 * - budget: both ends given 100, one end 60, none 0
 * - project match: interested in at least one project 100, otherwise 0
 * - source quality: the source's quality score (Settings → lead sources)
 * - engagement: answered calls, replies and meetings, re-enquiries and notes, faded when nothing happened for 30 days
 * Lost and Invalid leads score 0; Won leads keep the formula.
 */
export class WeightedScoring implements ScoringStrategy {
  score(f: ScoreFacts, w: ScoreWeights): number {
    if (f.stageCategory === 'lost' || f.stageCategory === 'invalid') return 0;
    const budget = f.hasBudgetMin && f.hasBudgetMax ? 100 : f.hasBudgetMin || f.hasBudgetMax ? 60 : 0;
    const project = f.projectCount > 0 ? 100 : 0;
    const source = Math.max(0, Math.min(100, f.sourceQuality));
    let engagement = Math.min(100, f.answeredCalls * 30 + f.inbound * 20 + (f.enquiryCount - 1) * 15 + f.notes * 5);
    const idleDays = f.lastActivityAt ? (Date.now() - f.lastActivityAt.getTime()) / 86_400_000 : 0;
    if (idleDays > 30) engagement = Math.round(engagement / 2);
    const total = (budget * w.budget_fit + project * w.project_match + source * w.source_quality + engagement * w.engagement) / 100;
    return Math.max(0, Math.min(100, Math.round(total)));
  }
}
