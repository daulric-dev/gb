import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { ClassTeacherGuard } from '@/class/class-teacher.guard';
import { EnrollmentService } from './enrollment.service';
import { EnrollStudentDto } from './dto/enroll-student.dto';
import { BulkEnrollDto } from './dto/bulk-enroll.dto';
import { AssignSubjectsDto } from './dto/assign-subjects.dto';
import { BulkAssignSubjectsDto } from './dto/bulk-assign-subjects.dto';

@ApiTags('Enrollment')
@ApiBearerAuth()
@Controller('classes/:classId')
@UseGuards(AuthGuard, ClassTeacherGuard)
export class EnrollmentController {
  constructor(private readonly enrollmentService: EnrollmentService) {}

  @Get('students')
  getEnrolledStudents(@Param('classId') classId: string) {
    return this.enrollmentService.getEnrolledStudents(classId);
  }

  @Post('enroll')
  enroll(@Param('classId') classId: string, @Body() dto: EnrollStudentDto) {
    return this.enrollmentService.enroll(classId, dto);
  }

  @Post('enroll/bulk')
  bulkEnroll(@Param('classId') classId: string, @Body() dto: BulkEnrollDto) {
    return this.enrollmentService.bulkEnroll(classId, dto);
  }

  @Delete('enroll/:studentId')
  unenroll(
    @Param('classId') classId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.enrollmentService.unenroll(classId, studentId);
  }

  @Get('students/:studentId/subjects')
  getStudentSubjects(
    @Param('classId') classId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.enrollmentService.getStudentSubjects(classId, studentId);
  }

  @Post('subjects')
  assignSubjects(
    @Param('classId') classId: string,
    @Body() dto: AssignSubjectsDto,
  ) {
    return this.enrollmentService.assignSubjects(classId, dto);
  }

  @Post('subjects/bulk')
  bulkAssignSubjects(
    @Param('classId') classId: string,
    @Body() dto: BulkAssignSubjectsDto,
  ) {
    return this.enrollmentService.bulkAssignSubjects(classId, dto);
  }

  @Delete('students/:studentId/subjects/:subjectId')
  removeSubject(
    @Param('classId') classId: string,
    @Param('studentId') studentId: string,
    @Param('subjectId') subjectId: string,
  ) {
    return this.enrollmentService.removeSubject(classId, studentId, subjectId);
  }
}
