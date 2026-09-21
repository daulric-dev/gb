import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { StudentGuard, type StudentRequest } from './student.guard';
import { StudentPortalService } from './student-portal.service';
import { AttendanceRangeDto } from './dto/attendance-range.dto';
import { GradesQueryDto } from './dto/grades-query.dto';

/**
 * The student's own view of their record.
 *
 * Deliberately separate from the staff API: no route here takes a student id,
 * and students hold no catalog permissions, so PermissionGuard denies them
 * every staff route. Scoping comes from StudentGuard, which pins the caller's
 * linked student to the request.
 */
@ApiTags('Student Portal')
@ApiBearerAuth()
@Controller('portal/me')
@UseGuards(AuthGuard, StudentGuard)
export class StudentPortalController {
  constructor(private readonly portal: StudentPortalService) {}

  @Get()
  async me(@Req() req: StudentRequest) {
    return this.portal.getMe(req.student!);
  }

  @Get('grades')
  async grades(@Req() req: StudentRequest, @Query() query: GradesQueryDto) {
    return this.portal.getGrades(req.student!, query.termId);
  }

  @Get('attendance')
  async attendance(
    @Req() req: StudentRequest,
    @Query() query: AttendanceRangeDto,
  ) {
    return this.portal.getAttendance(req.student!, query.from, query.to);
  }

  @Get('reports')
  async reports(@Req() req: StudentRequest) {
    return this.portal.getReports(req.student!);
  }

  @Get('reports/:reportId')
  async report(
    @Req() req: StudentRequest,
    @Param('reportId') reportId: string,
  ) {
    return this.portal.getReport(req.student!, reportId);
  }
}
