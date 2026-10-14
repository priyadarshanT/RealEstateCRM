import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { parseIfMatch, toEtag } from '../../core/http/etag';
import { PageQuery } from '../../core/http/pagination';
import { AttendanceService } from './attendance.service';
import {
  AttendancePolicyDto,
  AttendancePolicyInputDto,
  AttendancePolicyPage,
  AttendanceRecordDto,
  AttendanceRecordPage,
  CheckInDto,
  CorrectionDto,
  CorrectionInputDto,
  CorrectionListQuery,
  CorrectionPage,
  HolidayDto,
  HolidayInputDto,
  HolidayPage,
  LeaveListQuery,
  LeaveRequestDto,
  LeaveRequestInputDto,
  LeaveRequestPage,
  LeaveTypeDto,
  LeaveTypeInputDto,
  LeaveTypePage,
  RecordListQuery,
  ReviewDto,
} from './dto/attendance.dto';
import { LeaveService } from './leave.service';
import { PoliciesService } from './policies.service';

@ApiTags('Attendance')
@ApiBearerAuth('bearer')
@Controller()
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveService,
    private readonly policies: PoliciesService,
  ) {}

  // ---------------------------------------------------------------- own check-in / out (any signed-in user)
  @Post('attendance/check-in')
  @ApiOperation({ operationId: 'checkIn', summary: 'Check in with a live photo' })
  @ApiCreatedResponse({ type: AttendanceRecordDto })
  async checkIn(@CurrentPrincipal() p: Principal, @Body() body: CheckInDto): Promise<AttendanceRecordDto> {
    return AttendanceRecordDto.from(await this.attendance.checkIn(p, body));
  }

  @Post('attendance/check-out')
  @HttpCode(200)
  @ApiOperation({ operationId: 'checkOut', summary: 'Check out with a live photo' })
  @ApiOkResponse({ type: AttendanceRecordDto })
  async checkOut(@CurrentPrincipal() p: Principal, @Body() body: CheckInDto): Promise<AttendanceRecordDto> {
    return AttendanceRecordDto.from(await this.attendance.checkOut(p, body));
  }

  @Get('attendance/records')
  @RequirePermission('attendance.view')
  @ApiOperation({ operationId: 'listAttendanceRecords', summary: 'Attendance records' })
  @ApiOkResponse({ type: AttendanceRecordPage })
  records(@CurrentPrincipal() p: Principal, @Query() q: RecordListQuery): Promise<AttendanceRecordPage> {
    return this.attendance.list(p, q);
  }

  @Post('attendance/records/:id/corrections')
  @ApiOperation({ operationId: 'requestAttendanceCorrection', summary: 'Ask to correct my attendance' })
  @ApiCreatedResponse({ type: CorrectionDto })
  async requestCorrection(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: CorrectionInputDto): Promise<CorrectionDto> {
    return CorrectionDto.from(await this.attendance.requestCorrection(p, id, body));
  }

  @Get('attendance/corrections')
  @RequirePermission('attendance.approve')
  @ApiOperation({ operationId: 'listCorrectionRequests', summary: 'Correction requests' })
  @ApiOkResponse({ type: CorrectionPage })
  corrections(@CurrentPrincipal() p: Principal, @Query() q: CorrectionListQuery): Promise<CorrectionPage> {
    return this.attendance.listCorrections(p, q);
  }

  @Post('attendance/corrections/:id/review')
  @HttpCode(200)
  @RequirePermission('attendance.approve')
  @ApiOperation({ operationId: 'reviewCorrection', summary: 'Approve or reject a correction' })
  @ApiOkResponse({ type: CorrectionDto })
  async reviewCorrection(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewDto): Promise<CorrectionDto> {
    return CorrectionDto.from(await this.attendance.reviewCorrection(p, id, body));
  }

  // ---------------------------------------------------------------- leave
  @Get('leave-requests')
  @RequirePermission('attendance.view')
  @ApiOperation({ operationId: 'listLeaveRequests', summary: 'Leave requests' })
  @ApiOkResponse({ type: LeaveRequestPage })
  leaveRequests(@CurrentPrincipal() p: Principal, @Query() q: LeaveListQuery): Promise<LeaveRequestPage> {
    return this.leave.list(p, q);
  }

  @Post('leave-requests')
  @ApiOperation({ operationId: 'requestLeave', summary: 'Request leave' })
  @ApiCreatedResponse({ type: LeaveRequestDto })
  async requestLeave(@CurrentPrincipal() p: Principal, @Body() body: LeaveRequestInputDto): Promise<LeaveRequestDto> {
    return LeaveRequestDto.from(await this.leave.request(p, body));
  }

  @Post('leave-requests/:id/review')
  @HttpCode(200)
  @RequirePermission('attendance.approve')
  @ApiOperation({ operationId: 'reviewLeaveRequest', summary: 'Approve or reject leave' })
  @ApiOkResponse({ type: LeaveRequestDto })
  async reviewLeave(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewDto): Promise<LeaveRequestDto> {
    return LeaveRequestDto.from(await this.leave.review(p, id, body));
  }

  @Post('leave-requests/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ operationId: 'cancelLeaveRequest', summary: 'Cancel my leave request' })
  @ApiOkResponse({ type: LeaveRequestDto })
  async cancelLeave(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<LeaveRequestDto> {
    return LeaveRequestDto.from(await this.leave.cancel(p, id));
  }

  // ---------------------------------------------------------------- policies
  @Get('attendance-policies')
  @RequirePermission('attendance.view')
  @ApiOperation({ operationId: 'listAttendancePolicies', summary: 'Attendance policies' })
  @ApiOkResponse({ type: AttendancePolicyPage })
  listPolicies(@Query() q: PageQuery): Promise<AttendancePolicyPage> {
    return this.policies.listPolicies(q.limit, q.cursor);
  }

  @Post('attendance-policies')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'createAttendancePolicy', summary: 'Create a policy' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: AttendancePolicyDto })
  async createPolicy(@Body() body: AttendancePolicyInputDto, @Res({ passthrough: true }) res: Response): Promise<AttendancePolicyDto> {
    const row = await this.policies.createPolicy(body);
    res.setHeader('ETag', toEtag(row.updatedAt));
    return AttendancePolicyDto.from(row);
  }

  @Get('attendance-policies/:id')
  @RequirePermission('attendance.view')
  @ApiOperation({ operationId: 'getAttendancePolicy', summary: 'Get a policy' })
  @ApiOkResponse({ type: AttendancePolicyDto })
  async getPolicy(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<AttendancePolicyDto> {
    const row = await this.policies.getPolicy(id);
    res.setHeader('ETag', toEtag(row.updatedAt));
    return AttendancePolicyDto.from(row);
  }

  @Patch('attendance-policies/:id')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'updateAttendancePolicy', summary: 'Update a policy' })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiOkResponse({ type: AttendancePolicyDto })
  async updatePolicy(@Param('id', ParseUUIDPipe) id: string, @Body() body: AttendancePolicyInputDto, @Headers('if-match') ifMatch: string | undefined, @Res({ passthrough: true }) res: Response): Promise<AttendancePolicyDto> {
    const row = await this.policies.updatePolicy(id, body, parseIfMatch(ifMatch));
    res.setHeader('ETag', toEtag(row.updatedAt));
    return AttendancePolicyDto.from(row);
  }

  @Delete('attendance-policies/:id')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'deleteAttendancePolicy', summary: 'Delete a policy' })
  @ApiNoContentResponse({ description: 'Done' })
  deletePolicy(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.policies.deletePolicy(id);
  }

  // ---------------------------------------------------------------- holidays
  @Get('holidays')
  @RequirePermission('attendance.view')
  @ApiOperation({ operationId: 'listHolidays', summary: 'Holidays' })
  @ApiOkResponse({ type: HolidayPage })
  listHolidays(@Query() q: PageQuery): Promise<HolidayPage> {
    return this.policies.listHolidays(q.limit, q.cursor);
  }

  @Post('holidays')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'createHoliday', summary: 'Add a holiday' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: HolidayDto })
  async createHoliday(@Body() body: HolidayInputDto): Promise<HolidayDto> {
    return HolidayDto.from(await this.policies.createHoliday(body));
  }

  @Delete('holidays/:id')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'deleteHoliday', summary: 'Remove a holiday' })
  @ApiNoContentResponse({ description: 'Done' })
  deleteHoliday(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.policies.deleteHoliday(id);
  }

  // ---------------------------------------------------------------- leave types
  @Get('leave-types')
  @RequirePermission('attendance.view')
  @ApiOperation({ operationId: 'listLeaveTypes', summary: 'Leave types' })
  @ApiOkResponse({ type: LeaveTypePage })
  listLeaveTypes(@Query() q: PageQuery): Promise<LeaveTypePage> {
    return this.policies.listLeaveTypes(q.limit, q.cursor);
  }

  @Post('leave-types')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'createLeaveType', summary: 'Add a leave type' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: LeaveTypeDto })
  async createLeaveType(@Body() body: LeaveTypeInputDto): Promise<LeaveTypeDto> {
    return LeaveTypeDto.from(await this.policies.createLeaveType(body));
  }

  @Patch('leave-types/:id')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'updateLeaveType', summary: 'Update a leave type' })
  @ApiHeader({ name: 'If-Match', required: false })
  @ApiOkResponse({ type: LeaveTypeDto })
  async updateLeaveType(@Param('id', ParseUUIDPipe) id: string, @Body() body: LeaveTypeInputDto): Promise<LeaveTypeDto> {
    return LeaveTypeDto.from(await this.policies.updateLeaveType(id, body));
  }

  @Delete('leave-types/:id')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'deleteLeaveType', summary: 'Delete a leave type' })
  @ApiNoContentResponse({ description: 'Done' })
  deleteLeaveType(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.policies.deleteLeaveType(id);
  }
}
