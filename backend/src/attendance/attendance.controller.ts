import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { AuditLogService } from '@/audit-log/audit-log.service';
import { RequireStepUp } from '@/auth/step-up.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { AttendanceService } from './attendance.service';
import { AttendanceRealtime } from './attendance.realtime';
import {
  OpenAttendanceDto,
  SetAttendanceRecordDto,
  UpdateSessionLocationDto,
} from './dto/attendance.dto';
import { openEventStream } from './sse';

/**
 * Taking attendance in a course. Access is the caller's role in the course
 * (CourseAccessService): any staff role runs sessions and marks; deleting a
 * session takes a teacher.
 */
@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('courses/:courseId/attendance')
@UseGuards(AuthGuard, FeatureGuard)
@RequireFeature('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly realtime: AttendanceRealtime,
    private readonly audit: AuditLogService,
  ) {}

  @Get('sessions')
  async list(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.attendance.list(req.user.id as string, courseId);
  }

  @Post('sessions')
  async open(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: OpenAttendanceDto,
  ) {
    return this.attendance.open(req.user.id as string, courseId, dto);
  }

  @Get('sessions/:sessionId')
  async detail(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.attendance.detail(req.user.id as string, courseId, sessionId);
  }

  /** The QR frame the live screen shows now; it rotates every 15 s. */
  @Get('sessions/:sessionId/qr')
  async qr(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.attendance.qr(req.user.id as string, courseId, sessionId);
  }

  @Post('sessions/:sessionId/close')
  @HttpCode(200)
  async close(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.attendance.close(req.user.id as string, courseId, sessionId);
  }

  /**
   * The teacher's device moved: check-ins from now on measure from here.
   * 200 with the new point, or 204 when the fix was too coarse to use (the
   * point stays). 409 once closed or without a location check; 429 when
   * the point was set less than 5 s ago.
   */
  @Patch('sessions/:sessionId/location')
  async updateLocation(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: UpdateSessionLocationDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.attendance.updateLocation(
      req.user.id as string,
      courseId,
      sessionId,
      dto,
    );
    if (!result) {
      reply.status(204);
      return undefined;
    }
    return result;
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  async remove(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    await this.attendance.remove(req.user.id as string, courseId, sessionId);
  }

  @Patch('sessions/:sessionId/records/:studentId')
  async setRecord(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: SetAttendanceRecordDto,
  ) {
    return this.attendance.setRecord(
      req.user.id as string,
      courseId,
      sessionId,
      studentId,
      dto,
    );
  }

  /** Live roster: `attendance.record` per check-in or change, then `attendance.closed`. */
  @Get('sessions/:sessionId/stream')
  @ApiProduces('text/event-stream')
  async stream(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.attendance.assertSession(
      req.user.id as string,
      courseId,
      sessionId,
    );
    await openEventStream(req, reply, (send) =>
      this.realtime.subscribeSession(sessionId, send),
    );
  }

  @Get('summary')
  async summary(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.attendance.summary(req.user.id as string, courseId);
  }

  /** Bulk export of personal data: step-up, and audited with its row count. */
  @Get('export')
  @ApiProduces('text/csv')
  @RequireStepUp()
  async export(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Res() res: FastifyReply,
  ) {
    const { csv, filename } = await this.attendance.exportCsv(
      req.user.id as string,
      courseId,
    );
    await this.audit.recordExport(req.user.id as string, {
      courseId,
      entity: 'attendance',
      scope: 'course',
      csv,
    });

    return res
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Cache-Control', 'private, no-store')
      .send(csv);
  }
}
