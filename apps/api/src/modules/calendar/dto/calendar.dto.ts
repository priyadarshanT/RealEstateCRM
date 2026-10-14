import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { PageInfo, PageQuery } from '../../../core/http/pagination';
import { IsUuid } from '../../../core/http/validators';
import { BookingPageRow, MeetingRow } from '../calendar.schema';

const CHANNELS = ['google_meet', 'teams', 'in_person', 'phone'] as const;
const STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;
const iso = (d: Date | null) => d?.toISOString() ?? null;
const E164 = /^\+[1-9][0-9]{6,14}$/;

/** An IANA time zone such as Asia/Dubai or Europe/London. */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- components.schemas.Meeting
export class MeetingDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) leadId!: string;
  @ApiProperty({ format: 'uuid' }) organizerUserId!: string;
  @ApiProperty({ enum: ['meeting', 'viewing'] }) type!: 'meeting' | 'viewing';
  @ApiProperty({ enum: CHANNELS }) channel!: MeetingRow['channel'];
  @ApiPropertyOptional({ enum: ['agent', 'booking_page'], readOnly: true }) bookedVia!: 'agent' | 'booking_page';
  @ApiPropertyOptional({ type: String, nullable: true, readOnly: true }) joinUrl!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) location!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) projectId!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) unitId!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) dealId!: string | null;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ format: 'date-time' }) endsAt!: string;
  @ApiPropertyOptional() clientTimezone!: string;
  @ApiProperty({ enum: STATUSES }) status!: MeetingRow['status'];
  @ApiPropertyOptional({ type: String, nullable: true }) cancelReason!: string | null;

  static from(m: MeetingRow): MeetingDto {
    return {
      id: m.id,
      leadId: m.leadId,
      organizerUserId: m.organizerUserId,
      type: m.type,
      channel: m.channel,
      bookedVia: m.bookedVia,
      joinUrl: m.joinUrl,
      location: m.location,
      projectId: m.projectId,
      unitId: m.unitId,
      dealId: m.dealId,
      startsAt: m.startsAt.toISOString(),
      endsAt: m.endsAt.toISOString(),
      clientTimezone: m.clientTimezone,
      status: m.status,
      cancelReason: m.cancelReason,
    };
  }
}

export class MeetingPage {
  @ApiProperty({ type: [MeetingDto] }) data!: MeetingDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class MeetingListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() organizerUserId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() leadId?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: STATUSES }) @IsOptional() @IsIn(STATUSES) status?: MeetingRow['status'];
}

/** components.schemas.MeetingCreate */
export class MeetingCreateDto {
  @ApiProperty({ format: 'uuid' }) @IsUuid() leadId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUuid() organizerUserId!: string;
  @ApiProperty({ enum: ['meeting', 'viewing'] }) @IsIn(['meeting', 'viewing']) type!: 'meeting' | 'viewing';
  @ApiProperty({ enum: CHANNELS }) @IsIn(CHANNELS) channel!: MeetingRow['channel'];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) location?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() projectId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() unitId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() dealId?: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() startsAt!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() endsAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) clientTimezone?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sendConfirmation?: boolean;
}

export class MeetingRescheduleDto {
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() startsAt?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() endsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) location?: string;
}

export class CancelRequestDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

class NextActionDto {
  @ApiProperty({ enum: ['call', 'follow_up', 'meeting', 'viewing'] }) @IsIn(['call', 'follow_up', 'meeting', 'viewing']) type!: 'call' | 'follow_up' | 'meeting' | 'viewing';
  @ApiProperty({ format: 'date-time' }) @IsDateString() dueAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10080) reminderMinutes?: number;
}

export class MeetingCompleteDto {
  @ApiProperty({ enum: ['completed', 'no_show'] }) @IsIn(['completed', 'no_show']) status!: 'completed' | 'no_show';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) note?: string;
  @ApiPropertyOptional({ type: NextActionDto }) @IsOptional() @ValidateNested() @Type(() => NextActionDto) nextAction?: NextActionDto;
}

// ---------------------------------------------------------------- availability
export class AvailabilityQuery {
  @ApiProperty({ format: 'uuid' }) @IsUuid() userId!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() from!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() to!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (value === undefined ? undefined : Number(value))) @IsInt() @Min(10) @Max(240) durationMinutes?: number;
}

export class SlotDto {
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ format: 'date-time' }) endsAt!: string;
}

export class AvailabilityDto {
  @ApiProperty({ type: [SlotDto] }) slots!: SlotDto[];
}

// ---------------------------------------------------------------- components.schemas.BookingPage
export class BookingPageDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ pattern: '^[a-z0-9-]{3,60}$' }) slug!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ enum: CHANNELS }) meetingChannel!: BookingPageRow['meetingChannel'];
  @ApiProperty() durationMinutes!: number;
  @ApiPropertyOptional() bufferMinutes!: number;
  @ApiPropertyOptional() minNoticeHours!: number;
  @ApiProperty({ type: 'object', additionalProperties: true }) weeklyHours!: Record<string, unknown>;
  @ApiProperty() isActive!: boolean;
  @ApiPropertyOptional({ readOnly: true }) publicUrl!: string;

  static from(b: BookingPageRow, webAppUrl: string): BookingPageDto {
    return {
      id: b.id,
      slug: b.slug,
      title: b.title,
      meetingChannel: b.meetingChannel,
      durationMinutes: b.durationMinutes,
      bufferMinutes: b.bufferMinutes,
      minNoticeHours: b.minNoticeHours,
      weeklyHours: b.weeklyHours,
      isActive: b.isActive,
      publicUrl: `${webAppUrl.replace(/\/$/, '')}/book/${b.slug}`,
    };
  }
}

export class BookingPageInputDto {
  @IsOptional() id?: unknown;
  @IsOptional() publicUrl?: unknown;
  @ApiProperty({ pattern: '^[a-z0-9-]{3,60}$' }) @IsString() @Matches(/^[a-z0-9-]{3,60}$/, { message: 'slug uses 3–60 lowercase letters, digits and -' }) slug!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @ApiPropertyOptional({ enum: CHANNELS }) @IsOptional() @IsIn(CHANNELS) meetingChannel?: BookingPageRow['meetingChannel'];
  @ApiProperty() @IsInt() @Min(10) @Max(240) durationMinutes!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(240) bufferMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(720) minNoticeHours?: number;
  @ApiProperty({ type: 'object', additionalProperties: true }) @IsObject() weeklyHours!: Record<string, unknown>;
  @ApiProperty() @IsBoolean() isActive!: boolean;
}

// ---------------------------------------------------------------- public booking page
export class PublicBookingQuery {
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) timezone?: string;
}

export class PublicBookingPageDto {
  @ApiProperty() title!: string;
  @ApiProperty() agentName!: string;
  @ApiPropertyOptional() companyName!: string;
  @ApiPropertyOptional() durationMinutes!: number;
  @ApiPropertyOptional() meetingChannel!: string;
  @ApiProperty({ type: [SlotDto] }) slots!: SlotDto[];
}

export class PublicBookingRequestDto {
  @ApiProperty({ format: 'date-time' }) @IsDateString() startsAt!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) fullName!: string;
  @ApiProperty({ pattern: E164.source }) @Matches(E164, { message: 'phone must be in international format, e.g. +971501234567' }) phone!: string;
  @ApiPropertyOptional({ format: 'email' }) @IsOptional() @ValidateIf((_, v) => v !== '') @IsEmail() email?: string;
  @ApiProperty() @IsString() @MaxLength(64) timezone!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) message?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() consentWhatsApp?: boolean;
}

export class PublicBookingConfirmationDto {
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ format: 'date-time' }) endsAt!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) joinUrl!: string | null;
  @ApiProperty() timezone!: string;
}

export { iso };
