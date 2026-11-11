import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
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
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { userSchoolId } from '@/common/user-school';
import { PrismaService } from '@/prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';
import { AttendanceReportService } from './attendance-report.service';
import { AttendanceAlertService } from './attendance-alert.service';
import {
  AlertListDto,
  AlertSettingsDto,
  FormTutorDto,
  ReportRangeDto,
} from './dto/attendance-alerts.dto';

function sendCsv(reply: FastifyReply, out: { csv: string; filename: string }) {
  void reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${out.filename}"`)
    .header('Cache-Control', 'private, no-store')
    .send(out.csv);
}

/**
 * Attendance reports (school, student) and alerts. The school report needs
 * `attendance-report:read`; a form tutor sees their own tutees (checked in the
 * services); settings need `school:update`, form tutors `student:update`.
 */
@ApiTags('Attendance reports')
@ApiBearerAuth()
@Controller('attendance-reports')
@UseGuards(AuthGuard, PermissionGuard, FeatureGuard)
@RequireFeature('attendance', 'attendance_alerts')
export class AttendanceReportController {
  constructor(
    private readonly reports: AttendanceReportService,
    private readonly audit: AuditLogService,
  ) {}

  @Get('school')
  async school(@Req() req: any, @Query() q: ReportRangeDto) {
    return this.reports.school(req.user.id as string, q.from, q.to);
  }

  @Get('school/export')
  @ApiProduces('text/csv')
  @RequireStepUp()
  async schoolCsv(@Req() req: any, @Query() q: ReportRangeDto, @Res() reply: FastifyReply) {
    const out = await this.reports.schoolCsv(req.user.id as string, q.from, q.to);
    await this.audit.recordExport(req.user.id as string, {
      entity: 'attendance_report',
      scope: 'school',
      csv: out.csv,
      details: { from: q.from, to: q.to },
    });
    sendCsv(reply, out);
  }

  @Get('students/:studentId')
  async student(
    @Req() req: any,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() q: ReportRangeDto,
  ) {
    return this.reports.student(req.user.id as string, studentId, q.from, q.to);
  }

  @Get('students/:studentId/export')
  @ApiProduces('text/csv')
  @RequireStepUp()
  async studentCsv(
    @Req() req: any,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() q: ReportRangeDto,
    @Res() reply: FastifyReply,
  ) {
    const out = await this.reports.studentCsv(req.user.id as string, studentId, q.from, q.to);
    await this.audit.recordExport(req.user.id as string, {
      entity: 'attendance_report',
      entityId: studentId,
      scope: 'student',
      csv: out.csv,
      details: { from: q.from, to: q.to },
    });
    sendCsv(reply, out);
  }
}

/** One course's attendance report, for the course's staff. */
@ApiTags('Attendance reports')
@ApiBearerAuth()
@Controller('courses/:courseId/attendance-report')
@UseGuards(AuthGuard, FeatureGuard)
@RequireFeature('attendance', 'attendance_alerts')
export class CourseAttendanceReportController {
  constructor(
    private readonly reports: AttendanceReportService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  async get(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Query() q: ReportRangeDto,
  ) {
    return this.reports.course(req.user.id as string, courseId, q.from, q.to);
  }

  @Get('export')
  @ApiProduces('text/csv')
  @RequireStepUp()
  async csv(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Query() q: ReportRangeDto,
    @Res() reply: FastifyReply,
  ) {
    const out = await this.reports.courseCsv(req.user.id as string, courseId, q.from, q.to);
    await this.audit.recordExport(req.user.id as string, {
      courseId,
      entity: 'attendance_report',
      scope: 'course',
      csv: out.csv,
      details: { from: q.from, to: q.to },
    });
    sendCsv(reply, out);
  }
}

@ApiTags('Attendance alerts')
@ApiBearerAuth()
@Controller('attendance-alerts')
@UseGuards(AuthGuard, PermissionGuard, FeatureGuard)
@RequireFeature('attendance', 'attendance_alerts')
export class AttendanceAlertController {
  constructor(
    private readonly alerts: AttendanceAlertService,
    private readonly prisma: PrismaService,
  ) {}

  private async school(req: any): Promise<string> {
    const id = await userSchoolId(this.prisma, req.user.id as string);
    if (!id) throw new BadRequestException('You are not assigned to a school');
    return id;
  }

  @Get()
  async list(@Req() req: any, @Query() q: AlertListDto) {
    return this.alerts.list(req.user.id as string, q.status ?? 'open');
  }

  @Get('count')
  async count(@Req() req: any) {
    return this.alerts.count(req.user.id as string);
  }

  @Post(':alertId/acknowledge')
  @HttpCode(204)
  async acknowledge(@Req() req: any, @Param('alertId', ParseUUIDPipe) alertId: string) {
    await this.alerts.acknowledge(req.user.id as string, alertId);
  }

  @RequirePermission('school', 'update')
  @Get('settings')
  async settings(@Req() req: any) {
    return this.alerts.settings(await this.school(req));
  }

  @RequirePermission('school', 'update')
  @Put('settings')
  async updateSettings(@Req() req: any, @Body() dto: AlertSettingsDto) {
    return this.alerts.updateSettings(req.user.id as string, await this.school(req), dto);
  }

  @RequirePermission('student', 'update')
  @Get('form-tutors')
  async formTutors(@Req() req: any) {
    return this.alerts.formTutors(await this.school(req));
  }

  @RequirePermission('student', 'update')
  @Put('form-tutors')
  async setFormTutor(@Req() req: any, @Body() dto: FormTutorDto) {
    return this.alerts.setFormTutor(await this.school(req), dto.studentIds, dto.tutorId);
  }
}
