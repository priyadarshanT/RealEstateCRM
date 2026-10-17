import { Badge, type BadgeProps } from '@crm/ui';
import type { Schemas } from '@crm/contracts';

type Stage = Pick<Schemas['LeadStage'], 'key' | 'name' | 'category'> & { color?: string };

/** Lead status in its colour (Hot, Warm, Cold, Sale Done), with the substatus when there is one. */
export function StageBadge({ stage, substatus }: { stage: Stage | undefined; substatus?: string }) {
  if (!stage) return <Badge>—</Badge>;
  const color = stage.color ?? '#64748b';
  return (
    <span className="inline-flex max-w-56 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset" style={{ color, background: `${color}14`, boxShadow: `inset 0 0 0 1px ${color}40` }}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">
        {stage.name}
        {substatus ? <span className="font-normal opacity-80"> · {substatus}</span> : null}
      </span>
    </span>
  );
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
