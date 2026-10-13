import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { PageInfo, PageQuery } from '../../../core/http/pagination';
import { IsDateOnly, IsUuid } from '../../../core/http/validators';
import { CALL_OUTCOMES, CallOutcome, TASK_TYPES, TaskRow, TaskType } from '../tasks.schema';

const nullableUuid = { type: String, format: 'uuid', nullable: true } as const;
const NEXT_TYPES = ['call', 'follow_up', 'meeting', 'viewing'] as const;

// components.schemas.Task
export class TaskDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiPropertyOptional(nullableUuid) leadId!: string | null;
  @ApiProperty({ format: 'uuid' }) assignedUserId!: string;
  @ApiProperty({ enum: TASK_TYPES }) type!: TaskType;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ format: 'date-time' }) dueAt!: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) durationMinutes!: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) reminderMinutes!: number | null;
  @ApiPropertyOptional(nullableUuid) meetingId!: string | null;
  @ApiProperty({ enum: ['open', 'completed', 'cancelled'] }) status!: TaskRow['status'];
  @ApiPropertyOptional({ enum: CALL_OUTCOMES, nullable: true }) outcome!: CallOutcome | null;
  @ApiPropertyOptional({ type: String, nullable: true }) outcomeNote!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, readOnly: true }) completedAt!: string | null;

  static from(t: TaskRow): TaskDto {
    return {
      id: t.id,
      leadId: t.leadId,
      assignedUserId: t.assignedUserId,
      type: t.type,
      title: t.title,
      description: t.description,
      dueAt: t.dueAt.toISOString(),
      durationMinutes: t.durationMinutes,
      reminderMinutes: t.reminderMinutes,
      meetingId: t.meetingId,
      status: t.status,
      outcome: t.outcome,
      outcomeNote: t.outcomeNote,
      completedAt: t.completedAt?.toISOString() ?? null,
    };
  }
}

export class TaskPage {
  @ApiProperty({ type: [TaskDto] }) data!: TaskDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class TaskListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() assignedUserId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() leadId?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['open', 'completed', 'cancelled']) status?: TaskRow['status'];
  @ApiPropertyOptional() @IsOptional() @IsIn(TASK_TYPES) type?: TaskType;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() to?: string;
  @ApiPropertyOptional({ enum: ['day', 'week', 'month', 'list'] }) @IsOptional() @IsIn(['day', 'week', 'month', 'list']) view?: 'day' | 'week' | 'month' | 'list';
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  overdue?: boolean;
}

/** POST /tasks and PATCH /tasks/{id} (body: Task). type, title and dueAt are required on create. */
export class TaskInputDto {
  @IsOptional() @IsUuid() id?: string;
  @IsOptional() @IsIn(['open', 'completed', 'cancelled']) status?: string;
  @IsOptional() completedAt?: unknown;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(CALL_OUTCOMES) outcome?: CallOutcome | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() outcomeNote?: string | null;

  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() leadId?: string | null;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() assignedUserId?: string;
  @ApiPropertyOptional({ enum: TASK_TYPES }) @IsOptional() @IsIn(TASK_TYPES) type?: TaskType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5000) description?: string | null;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() dueAt?: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(1440) durationMinutes?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(10080) reminderMinutes?: number | null;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() meetingId?: string | null;
}

export class NextActionDto {
  @ApiProperty({ enum: NEXT_TYPES }) @IsIn(NEXT_TYPES) type!: (typeof NEXT_TYPES)[number];
  @ApiProperty({ format: 'date-time' }) @IsDateString() dueAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10080) reminderMinutes?: number;
}

/** components.schemas.TaskComplete */
export class TaskCompleteDto {
  @ApiPropertyOptional({ enum: CALL_OUTCOMES }) @IsOptional() @IsIn(CALL_OUTCOMES) outcome?: CallOutcome;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) outcomeNote?: string;
  @ApiPropertyOptional({ type: NextActionDto }) @IsOptional() @ValidateNested() @Type(() => NextActionDto) nextAction?: NextActionDto;
}

export class TaskCompleteResult {
  @ApiProperty({ type: TaskDto }) task!: TaskDto;
  @ApiPropertyOptional({ type: TaskDto, nullable: true }) nextTask!: TaskDto | null;
}

/** components.schemas.CallLog: a call that was not planned as a task. */
export class CallLogDto {
  @ApiProperty({ enum: CALL_OUTCOMES }) @IsIn(CALL_OUTCOMES) outcome!: CallOutcome;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(86_400) durationSeconds?: number;
  @ApiPropertyOptional({ type: NextActionDto }) @IsOptional() @ValidateNested() @Type(() => NextActionDto) nextAction?: NextActionDto;
}
