import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import {
  StudentGuard,
  type StudentRequest,
} from '@/student-portal/student.guard';
import { CalendarService, toIcs } from './calendar.service';
import { CalendarRangeQueryDto } from './dto/calendar-range.query.dto';

function sendIcs(reply: FastifyReply, body: string, filename: string) {
  return reply
    .header('Content-Type', 'text/calendar; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .header('Cache-Control', 'private, no-store')
    .send(body);
}

/** Due dates across the courses the caller teaches or assists. */
@ApiTags('Calendar')
@ApiBearerAuth()
@Controller('calendar')
@UseGuards(AuthGuard)
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  async list(@Req() req: any, @Query() query: CalendarRangeQueryDto) {
    return this.calendar.forStaff(req.user.id as string, query.from, query.to);
  }

  @Get('ics')
  @ApiProduces('text/calendar')
  async ics(
    @Req() req: any,
    @Query() query: CalendarRangeQueryDto,
    @Res() reply: FastifyReply,
  ) {
    const items = await this.calendar.forStaff(
      req.user.id as string,
      query.from,
      query.to,
    );
    return sendIcs(reply, toIcs(items, 'GradeBook due dates'), 'gradebook.ics');
  }
}

/** A student's due dates across their published courses. */
@ApiTags('Student Portal')
@ApiBearerAuth()
@Controller('portal/me/calendar')
@UseGuards(AuthGuard, StudentGuard)
export class PortalCalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  async list(
    @Req() req: StudentRequest,
    @Query() query: CalendarRangeQueryDto,
  ) {
    return this.calendar.forStudent(
      req.student!.studentId,
      query.from,
      query.to,
    );
  }

  @Get('ics')
  @ApiProduces('text/calendar')
  async ics(
    @Req() req: StudentRequest,
    @Query() query: CalendarRangeQueryDto,
    @Res() reply: FastifyReply,
  ) {
    const items = await this.calendar.forStudent(
      req.student!.studentId,
      query.from,
      query.to,
    );
    return sendIcs(reply, toIcs(items, 'My due dates'), 'due-dates.ics');
  }
}
