import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PageInfo, PageQuery } from '../../../core/http/pagination';
import { IsDateOnly, IsUuid } from '../../../core/http/validators';
import { CorrectionRow, DAY_STATUSES, DayStatus, HolidayRow, LeaveRequestRow, LeaveTypeRow, PolicyRow, RecordRow } from '../attendance.schema';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const nullableString = { type: String, nullable: true } as const;
const nullableUuid = { type: String, format: 'uuid', nullable: true } as const;
const nullableDateTime = { type: String, format: 'date-time', nullable: true } as const;
const hhmm = (t: string) => t.slice(0, 5);

// ---------------------------------------------------------------- policies (components.schemas.AttendancePolicy)
export class AttendancePolicyDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '09:00' }) workStart!: string;
  @ApiProperty({ example: '18:00' }) workEnd!: string;
  @ApiPropertyOptional() graceMinutes!: number;
  @ApiPropertyOptional() halfDayMaxMinutes!: number;
  @ApiProperty({ type: [Number] }) weekendDays!: number[];
  @ApiPropertyOptional() locationRequired!: boolean;
  @ApiPropertyOptional({ type: Number, nullable: true }) officeLatitude!: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) officeLongitude!: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) officeRadiusM!: number | null;
  @ApiPropertyOptional() isDefault!: boolean;

  static from(p: PolicyRow): AttendancePolicyDto {
    return {
      id: p.id,
      name: p.name,
      workStart: hhmm(p.workStart),
      workEnd: hhmm(p.workEnd),
      graceMinutes: p.graceMinutes,
      halfDayMaxMinutes: p.halfDayMaxMinutes,
      weekendDays: p.weekendDays,
      locationRequired: p.locationRequired,
      officeLatitude: p.officeLatitude === null ? null : Number(p.officeLatitude),
      officeLongitude: p.officeLongitude === null ? null : Number(p.officeLongitude),
      officeRadiusM: p.officeRadiusM,
      isDefault: p.isDefault,
    };
  }
}

export class AttendancePolicyPage {
  @ApiProperty({ type: [AttendancePolicyDto] }) data!: AttendancePolicyDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class AttendancePolicyInputDto {
  @IsOptional() id?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @ApiPropertyOptional({ example: '09:00' }) @IsOptional() @Matches(TIME) workStart?: string;
  @ApiPropertyOptional({ example: '18:00' }) @IsOptional() @Matches(TIME) workEnd?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(240) graceMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1440) halfDayMaxMinutes?: number;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @ArrayMaxSize(6) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekendDays?: number[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() locationRequired?: boolean;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(-90) @Max(90) officeLatitude?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(-180) @Max(180) officeLongitude?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(10) @Max(100_000) officeRadiusM?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

// ---------------------------------------------------------------- holidays and leave types
export class HolidayDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'date' }) holidayDate!: string;
  @ApiProperty() name!: string;

  static from(h: HolidayRow): HolidayDto {
    return { id: h.id, holidayDate: h.holidayDate, name: h.name };
  }
}

export class HolidayPage {
  @ApiProperty({ type: [HolidayDto] }) data!: HolidayDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class HolidayInputDto {
  @IsOptional() id?: unknown;
  @ApiProperty({ format: 'date' }) @IsDateOnly() holidayDate!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name!: string;
}

export class LeaveTypeDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional(nullableString) annualDays!: string | null;
  @ApiPropertyOptional() isPaid!: boolean;
  @ApiPropertyOptional() isActive!: boolean;

  static from(t: LeaveTypeRow): LeaveTypeDto {
    return { id: t.id, name: t.name, annualDays: t.annualDays === null ? null : Number(t.annualDays).toString(), isPaid: t.isPaid, isActive: t.isActive };
  }
}

export class LeaveTypePage {
  @ApiProperty({ type: [LeaveTypeDto] }) data!: LeaveTypeDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class LeaveTypeInputDto {
  @IsOptional() id?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^\d{1,3}(\.[05])?$/) annualDays?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPaid?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------------------------------------------------------------- check-in, records, corrections
/** components.schemas.CheckIn: location is required only when the tenant's policy requires it. */
export class CheckInDto {
  @ApiProperty({ format: 'uuid' }) @IsUuid() photoFileId!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() workFromHome?: boolean;
}

export class AttendanceRecordDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ format: 'date' }) workDate!: string;
  @ApiProperty({ enum: DAY_STATUSES }) status!: DayStatus;
  @ApiPropertyOptional(nullableDateTime) checkInAt!: string | null;
  @ApiPropertyOptional(nullableDateTime) checkOutAt!: string | null;
  @ApiPropertyOptional(nullableUuid) checkInPhotoFileId!: string | null;
  @ApiPropertyOptional(nullableUuid) checkOutPhotoFileId!: string | null;
  @ApiProperty() isCorrected!: boolean;

  static from(r: RecordRow): AttendanceRecordDto {
    return {
      id: r.id,
      userId: r.userId,
      workDate: r.workDate,
      status: r.status,
      checkInAt: r.checkInAt?.toISOString() ?? null,
      checkOutAt: r.checkOutAt?.toISOString() ?? null,
      checkInPhotoFileId: r.checkInPhotoFileId,
      checkOutPhotoFileId: r.checkOutPhotoFileId,
      isCorrected: r.isCorrected,
    };
  }
}

export class AttendanceRecordPage {
  @ApiProperty({ type: [AttendanceRecordDto] }) data!: AttendanceRecordDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class RecordListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() userId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() teamId?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() to?: string;
  @ApiPropertyOptional({ enum: DAY_STATUSES }) @IsOptional() @IsIn(DAY_STATUSES) status?: DayStatus;
}

export class CorrectionDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) recordId!: string;
  @ApiProperty({ enum: DAY_STATUSES }) requestedStatus!: DayStatus;
  @ApiPropertyOptional(nullableDateTime) requestedCheckInAt!: string | null;
  @ApiPropertyOptional(nullableDateTime) requestedCheckOutAt!: string | null;
  @ApiProperty() reason!: string;
  @ApiProperty({ enum: ['pending', 'approved', 'rejected'], readOnly: true }) status!: CorrectionRow['status'];
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, readOnly: true }) originalValues!: Record<string, unknown>;
  @ApiPropertyOptional({ ...nullableUuid, readOnly: true }) reviewedBy!: string | null;
  @ApiPropertyOptional(nullableString) reviewNote!: string | null;

  static from(c: CorrectionRow): CorrectionDto {
    return {
      id: c.id,
      recordId: c.recordId,
      requestedStatus: c.requestedStatus,
      requestedCheckInAt: c.requestedCheckInAt?.toISOString() ?? null,
      requestedCheckOutAt: c.requestedCheckOutAt?.toISOString() ?? null,
      reason: c.reason,
      status: c.status,
      originalValues: c.originalValues,
      reviewedBy: c.reviewedBy,
      reviewNote: c.reviewNote,
    };
  }
}

export class CorrectionPage {
  @ApiProperty({ type: [CorrectionDto] }) data!: CorrectionDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class CorrectionListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected'] }) @IsOptional() @IsIn(['pending', 'approved', 'rejected']) status?: CorrectionRow['status'];
}

export class CorrectionInputDto {
  @IsOptional() id?: unknown;
  @IsOptional() recordId?: unknown;
  @IsOptional() status?: unknown;
  @IsOptional() originalValues?: unknown;
  @IsOptional() reviewedBy?: unknown;
  @IsOptional() reviewNote?: unknown;
  @ApiProperty({ enum: DAY_STATUSES }) @IsIn(DAY_STATUSES) requestedStatus!: DayStatus;
  @ApiPropertyOptional(nullableDateTime) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^\d{4}-\d{2}-\d{2}T/) requestedCheckInAt?: string | null;
  @ApiPropertyOptional(nullableDateTime) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^\d{4}-\d{2}-\d{2}T/) requestedCheckOutAt?: string | null;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}

/** components.schemas.Review */
export class ReviewDto {
  @ApiProperty({ enum: ['approve', 'reject'] }) @IsIn(['approve', 'reject']) decision!: 'approve' | 'reject';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

// ---------------------------------------------------------------- leave requests
export class LeaveRequestDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ format: 'uuid' }) leaveTypeId!: string;
  @ApiProperty({ format: 'date' }) startDate!: string;
  @ApiProperty({ format: 'date' }) endDate!: string;
  @ApiPropertyOptional() isHalfDay!: boolean;
  @ApiPropertyOptional(nullableString) reason!: string | null;
  @ApiProperty({ enum: ['pending', 'approved', 'rejected', 'cancelled'], readOnly: true }) status!: LeaveRequestRow['status'];
  @ApiPropertyOptional({ ...nullableUuid, readOnly: true }) reviewedBy!: string | null;
  @ApiPropertyOptional(nullableString) reviewNote!: string | null;

  static from(l: LeaveRequestRow): LeaveRequestDto {
    return { id: l.id, userId: l.userId, leaveTypeId: l.leaveTypeId, startDate: l.startDate, endDate: l.endDate, isHalfDay: l.isHalfDay, reason: l.reason, status: l.status, reviewedBy: l.reviewedBy, reviewNote: l.reviewNote };
  }
}

export class LeaveRequestPage {
  @ApiProperty({ type: [LeaveRequestDto] }) data!: LeaveRequestDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class LeaveListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() userId?: string;
  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected', 'cancelled'] }) @IsOptional() @IsIn(['pending', 'approved', 'rejected', 'cancelled']) status?: LeaveRequestRow['status'];
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateOnly() to?: string;
}

export class LeaveRequestInputDto {
  @IsOptional() id?: unknown;
  @IsOptional() userId?: unknown;
  @IsOptional() status?: unknown;
  @IsOptional() reviewedBy?: unknown;
  @IsOptional() reviewNote?: unknown;
  @ApiProperty({ format: 'uuid' }) @IsUuid() leaveTypeId!: string;
  @ApiProperty({ format: 'date' }) @IsDateOnly() startDate!: string;
  @ApiProperty({ format: 'date' }) @IsDateOnly() endDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isHalfDay?: boolean;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) reason?: string | null;
}
