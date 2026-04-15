import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
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
@UseGuards(AuthGuard)
export class EnrollmentController {
  constructor(private readonly enrollmentService: EnrollmentService) {}

  @Get('students')
  getEnrolledStudents(
    @Req() req: any,
    @Param('classId') classId: string,
    @Query('subjectId') subjectId?: string,
  ) {
    return this.enrollmentService.getEnrolledStudents(
      classId,
      req.user.id,
      subjectId,
    );
  }

  @Get('students/:studentId/subjects')
  getStudentSubjects(
    @Param('classId') classId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.enrollmentService.getStudentSubjects(classId, studentId);
  }

  @UseGuards(ClassTeacherGuard)
  @Post('enroll')
  enroll(@Param('classId') classId: string, @Body() dto: EnrollStudentDto) {
    return this.enrollmentService.enroll(classId, dto);
  }

  @UseGuards(ClassTeacherGuard)
  @Post('enroll/bulk')
  bulkEnroll(@Param('classId') classId: string, @Body() dto: BulkEnrollDto) {
    return this.enrollmentService.bulkEnroll(classId, dto);
  }

  @UseGuards(ClassTeacherGuard)
  @Delete('enroll/:studentId')
  unenroll(
    @Param('classId') classId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.enrollmentService.unenroll(classId, studentId);
  }

  @UseGuards(ClassTeacherGuard)
  @Post('subjects')
  assignSubjects(
    @Param('classId') classId: string,
    @Body() dto: AssignSubjectsDto,
  ) {
    return this.enrollmentService.assignSubjects(classId, dto);
  }

  @UseGuards(ClassTeacherGuard)
  @Post('subjects/bulk')
  bulkAssignSubjects(
    @Param('classId') classId: string,
    @Body() dto: BulkAssignSubjectsDto,
  ) {
    return this.enrollmentService.bulkAssignSubjects(classId, dto);
  }

  @UseGuards(ClassTeacherGuard)
  @Delete('students/:studentId/subjects/:subjectId')
  removeSubject(
    @Param('classId') classId: string,
    @Param('studentId') studentId: string,
    @Param('subjectId') subjectId: string,
  ) {
    return this.enrollmentService.removeSubject(classId, studentId, subjectId);
  }
}
