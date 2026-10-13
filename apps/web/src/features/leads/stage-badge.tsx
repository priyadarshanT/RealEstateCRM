import { Badge, type BadgeProps } from '@crm/ui';
import type { Schemas } from '@crm/contracts';

type Stage = Pick<Schemas['LeadStage'], 'key' | 'name' | 'category'>;

const TONE_BY_KEY: Record<string, BadgeProps['tone']> = {
  hot: 'danger',
  warm: 'warning',
  qualified: 'success',
  follow_up: 'info',
  attempted: 'warning',
  won: 'success',
  booked: 'success',
};

export function StageBadge({ stage }: { stage: Stage | undefined }) {
  if (!stage) return <Badge>—</Badge>;
  const tone = TONE_BY_KEY[stage.key] ?? (stage.category === 'lost' || stage.category === 'invalid' ? 'neutral' : 'primary');
  return <Badge tone={tone}>{stage.name}</Badge>;
}

export function ScoreBadge({ score }: { score: number }) {
  const tone: BadgeProps['tone'] = score >= 80 ? 'success' : score >= 50 ? 'warning' : 'neutral';
  return (
    <Badge tone={tone} className="tabular-nums">
      {score}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: 'low' | 'medium' | 'high' | undefined }) {
  if (!priority) return null;
  const tone: BadgeProps['tone'] = priority === 'high' ? 'danger' : priority === 'medium' ? 'warning' : 'neutral';
  return <Badge tone={tone}>{priority[0]!.toUpperCase() + priority.slice(1)}</Badge>;
}
