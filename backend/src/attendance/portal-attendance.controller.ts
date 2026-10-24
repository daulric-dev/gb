import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import {
  StudentGuard,
  type StudentRequest,
} from '@/student-portal/student.guard';
import { AttendanceService } from './attendance.service';
import { AttendanceRealtime } from './attendance.realtime';
import { CheckInDto } from './dto/attendance.dto';
import { openEventStream } from './sse';

/**
 * A student's side of attendance, and the portal's live stream. As with the
 * rest of the portal, the student is the one StudentGuard resolved, never an
 * id from the client, and the check-in code is never sent.
 */
@ApiTags('Student Portal')
@ApiBearerAuth()
@Controller('portal/me')
@UseGuards(AuthGuard, StudentGuard)
export class PortalAttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly realtime: AttendanceRealtime,
  ) {}

  @Get('attendance/open')
  async open(@Req() req: StudentRequest) {
    return this.attendance.openForStudent(req.student!.studentId);
  }

  /**
   * Codes are four digits. The per-session wrong-code limit stops guessing
   * one session; this stops hammering across them.
   */
  @Throttle({ 'claim-code': { limit: 30, ttl: 15 * 60 * 1000 } })
  @Post('attendance/:sessionId/check-in')
  @HttpCode(200)
  async checkIn(
    @Req() req: StudentRequest,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: CheckInDto,
  ) {
    return this.attendance.checkIn(req.student!.studentId, sessionId, dto);
  }

  @Get('courses/:courseId/attendance')
  async course(
    @Req() req: StudentRequest,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.attendance.courseForStudent(req.student!.studentId, courseId);
  }

  /** `attendance.opened` and `attendance.closed` for the caller's courses. */
  @Get('stream')
  @ApiProduces('text/event-stream')
  async stream(
    @Req() req: StudentRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const userId = req.user!.id;
    await openEventStream(req, reply, (send) =>
      this.realtime.subscribePortal(userId, send),
    );
  }
}
