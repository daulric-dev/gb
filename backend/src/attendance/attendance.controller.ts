import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { ClassTeacherGuard } from '@/class/class-teacher.guard';
import { VersioningService } from '@/versioning/versioning.service';
import { AttendanceService } from './attendance.service';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { BulkMarkAttendanceDto } from './dto/bulk-mark-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { AttendanceRangeQueryDto } from './dto/attendance-range.dto';

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('classes/:classId/attendance')
@UseGuards(AuthGuard)
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly versioning: VersioningService,
  ) {}

  @Get()
  async roster(
    @Req() req: any,
    @Param('classId') classId: string,
    @Query('date') date: string,
  ) {
    await this.attendanceService.assertCanViewClass(req.user.id, classId);
    const raw = await this.attendanceService.getClassRosterForDate(
      classId,
      date,
    );
    return this.versioning.resolve(req, 'attendance.roster')(raw);
  }

  @UseGuards(ClassTeacherGuard)
  @Post()
  async mark(
    @Req() req: any,
    @Param('classId') classId: string,
    @Body() dto: MarkAttendanceDto,
  ) {
    const raw = await this.attendanceService.mark(classId, req.user.id, dto);
    return this.versioning.resolve(req, 'attendance.marked')(raw);
  }

  @UseGuards(ClassTeacherGuard)
  @Post('bulk')
  async bulkMark(
    @Req() req: any,
    @Param('classId') classId: string,
    @Body() dto: BulkMarkAttendanceDto,
  ) {
    const raw = await this.attendanceService.bulkMark(
      classId,
      req.user.id,
      dto,
    );
    return this.versioning.resolve(req, 'attendance.bulkMarked')(raw);
  }

  @UseGuards(ClassTeacherGuard)
  @Patch(':recordId')
  async update(
    @Req() req: any,
    @Param('classId') classId: string,
    @Param('recordId') recordId: string,
    @Body() dto: UpdateAttendanceDto,
  ) {
    const raw = await this.attendanceService.update(
      classId,
      recordId,
      req.user.id,
      dto,
    );
    return this.versioning.resolve(req, 'attendance.updated')(raw);
  }

  @UseGuards(ClassTeacherGuard)
  @Delete(':recordId')
  async remove(
    @Req() req: any,
    @Param('classId') classId: string,
    @Param('recordId') recordId: string,
  ) {
    const raw = await this.attendanceService.delete(classId, recordId);
    return this.versioning.resolve(req, 'attendance.deleted')(raw);
  }

  @Get('students/:studentId')
  async studentRange(
    @Req() req: any,
    @Param('classId') classId: string,
    @Param('studentId') studentId: string,
    @Query() range: AttendanceRangeQueryDto,
  ) {
    await this.attendanceService.assertCanViewClass(req.user.id, classId);
    const raw = await this.attendanceService.getStudentRange(
      classId,
      studentId,
      range.from,
      range.to,
    );
    return this.versioning.resolve(req, 'attendance.studentRange')(raw);
  }

  @Get('students/:studentId/summary')
  async studentSummary(
    @Req() req: any,
    @Param('classId') classId: string,
    @Param('studentId') studentId: string,
    @Query() range: AttendanceRangeQueryDto,
  ) {
    await this.attendanceService.assertCanViewClass(req.user.id, classId);
    const raw = await this.attendanceService.getStudentSummary(
      classId,
      studentId,
      range.from,
      range.to,
    );
    return this.versioning.resolve(req, 'attendance.studentSummary')(raw);
  }
}
