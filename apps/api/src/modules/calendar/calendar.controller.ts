import { Body, Controller, Get, Headers, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentPrincipal, Public, RequirePermission } from '../../core/auth/decorators';
import { Principal } from '../../core/auth/principal';
import { BookingService } from './booking.service';
import {
  AvailabilityDto,
  AvailabilityQuery,
  BookingPageDto,
  BookingPageInputDto,
  CancelRequestDto,
  MeetingCompleteDto,
  MeetingCreateDto,
  MeetingDto,
  MeetingListQuery,
  MeetingPage,
  MeetingRescheduleDto,
  PublicBookingConfirmationDto,
  PublicBookingPageDto,
  PublicBookingQuery,
  PublicBookingRequestDto,
} from './dto/calendar.dto';
import { MeetingsService } from './meetings.service';

@ApiTags('Meetings')
@ApiBearerAuth('bearer')
@Controller()
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly booking: BookingService,
  ) {}

  @Get('meetings')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listMeetings', summary: 'List meetings' })
  @ApiOkResponse({ type: MeetingPage })
  list(@CurrentPrincipal() p: Principal, @Query() query: MeetingListQuery): Promise<MeetingPage> {
    return this.meetings.list(p, query);
  }

  @Post('meetings')
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'createMeeting', summary: 'Create meeting' })
  @ApiCreatedResponse({ type: MeetingDto })
  create(@CurrentPrincipal() p: Principal, @Body() body: MeetingCreateDto): Promise<MeetingDto> {
    return this.meetings.create(p, body);
  }

  @Get('meetings/:id')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getMeeting', summary: 'Get meeting' })
  @ApiOkResponse({ type: MeetingDto })
  async get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<MeetingDto> {
    return MeetingDto.from(await this.meetings.get(p, id));
  }

  @Patch('meetings/:id')
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'rescheduleMeeting', summary: 'Reschedule meeting' })
  @ApiOkResponse({ type: MeetingDto })
  reschedule(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: MeetingRescheduleDto): Promise<MeetingDto> {
    return this.meetings.reschedule(p, id, body);
  }

  @Post('meetings/:id/cancel')
  @HttpCode(200)
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'cancelMeeting', summary: 'Cancel meeting' })
  @ApiOkResponse({ type: MeetingDto })
  cancel(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: CancelRequestDto): Promise<MeetingDto> {
    return this.meetings.cancel(p, id, body.reason);
  }

  @Post('meetings/:id/complete')
  @HttpCode(200)
  @RequirePermission('leads.edit')
  @ApiOperation({ operationId: 'completeMeeting', summary: 'Complete meeting' })
  @ApiOkResponse({ type: MeetingDto })
  complete(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: MeetingCompleteDto): Promise<MeetingDto> {
    return this.meetings.complete(p, id, body);
  }

  @Get('availability')
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'getAgentFreeSlots', summary: 'Get agent free slots' })
  @ApiOkResponse({ type: AvailabilityDto })
  availability(@Query() query: AvailabilityQuery): Promise<AvailabilityDto> {
    return this.booking.availability(query);
  }

  @Get('booking-pages/me')
  @ApiOperation({ operationId: 'getMyBookingPage', summary: 'Get my booking page' })
  @ApiOkResponse({ type: BookingPageDto })
  myPage(@CurrentPrincipal() p: Principal): Promise<BookingPageDto> {
    return this.booking.getMine(p);
  }

  @Put('booking-pages/me')
  @ApiOperation({ operationId: 'saveMyBookingPage', summary: 'Save my booking page' })
  @ApiOkResponse({ type: BookingPageDto })
  saveMyPage(@CurrentPrincipal() p: Principal, @Body() body: BookingPageInputDto): Promise<BookingPageDto> {
    return this.booking.saveMine(p, body);
  }
}

/** The client's booking page (API guide §9): no login, 30 requests per minute per IP, bot check when booking. */
@ApiTags('Public booking page')
@Controller('public/booking')
@Public()
@Throttle({ user: { limit: 30, ttl: 60_000 } })
export class PublicBookingController {
  constructor(private readonly booking: BookingService) {}

  @Get(':slug')
  @ApiOperation({ operationId: 'getPublicBookingPage', summary: 'Get public booking page' })
  @ApiOkResponse({ type: PublicBookingPageDto })
  page(@Param('slug') slug: string, @Query() query: PublicBookingQuery): Promise<PublicBookingPageDto> {
    return this.booking.publicPage(slug, query);
  }

  @Post(':slug')
  @ApiOperation({ operationId: 'bookASlot', summary: 'Book a slot' })
  @ApiCreatedResponse({ type: PublicBookingConfirmationDto })
  book(@Param('slug') slug: string, @Body() body: PublicBookingRequestDto, @Headers('cf-turnstile-token') token: string | undefined, @Ip() ip: string): Promise<PublicBookingConfirmationDto> {
    return this.booking.book(slug, body, token ?? '', ip);
  }
}
