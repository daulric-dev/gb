import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { JoinCourseDto } from '@/course/dto/course.dto';
import { StudentGuard, type StudentRequest } from './student.guard';
import { StudentPortalService } from './student-portal.service';

/**
 * The student's own view of their record and courses.
 *
 * Deliberately separate from the staff API: no route here takes a student id,
 * and students hold no catalog permissions or course staff roles, so every
 * staff route turns them away. Scoping comes from StudentGuard, which pins
 * the caller's linked student to the request.
 *
 * Course activities and grades live beside these in PortalActivityController
 * (`courses/:courseId/activities`, `courses/:courseId/grades`).
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

  @Get('courses')
  async courses(@Req() req: StudentRequest) {
    return this.portal.listCourses(req.student!);
  }

  /** Join codes are short; throttle guessing the same way as claim codes. */
  @Throttle({ 'claim-code': { limit: 10, ttl: 15 * 60 * 1000 } })
  @Post('courses/join')
  async join(@Req() req: StudentRequest, @Body() dto: JoinCourseDto) {
    return this.portal.joinCourse(req.student!, dto.joinCode);
  }

  @Get('courses/:courseId')
  async course(
    @Req() req: StudentRequest,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.portal.getCourse(req.student!, courseId);
  }

  @Get('courses/:courseId/modules')
  async modules(
    @Req() req: StudentRequest,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.portal.getModules(req.student!, courseId);
  }

  @Get('courses/:courseId/pages/:pageId')
  async page(
    @Req() req: StudentRequest,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
  ) {
    return this.portal.getPage(req.student!, courseId, pageId);
  }

  @Get('courses/:courseId/announcements')
  async announcements(
    @Req() req: StudentRequest,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.portal.getAnnouncements(req.student!, courseId);
  }
}
