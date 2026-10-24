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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { CourseService } from './course.service';
import {
  AddCourseStaffDto,
  CreateCourseDto,
  EnrollStudentsDto,
  ListCoursesQueryDto,
  UpdateCourseDto,
  UpdateCourseStaffDto,
} from './dto/course.dto';

/**
 * Courses and their people.
 *
 * Only listing and creating are catalog-gated. Everything keyed by a course
 * is decided by the caller's role in that course (CourseAccessService), so a
 * teacher runs their own course without any school-wide grant.
 */
@ApiTags('Courses')
@ApiBearerAuth()
@Controller('courses')
@UseGuards(AuthGuard, PermissionGuard)
export class CourseController {
  constructor(private readonly courses: CourseService) {}

  @Get()
  async list(@Req() req: any, @Query() query: ListCoursesQueryDto) {
    return this.courses.list(req.user.id as string, query);
  }

  @RequirePermission('course', 'create')
  @Post()
  async create(@Req() req: any, @Body() dto: CreateCourseDto) {
    return this.courses.create(req.user.id as string, dto);
  }

  @Get(':courseId')
  async get(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.courses.get(req.user.id as string, courseId);
  }

  @Patch(':courseId')
  async update(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: UpdateCourseDto,
  ) {
    return this.courses.update(req.user.id as string, courseId, dto);
  }

  @Delete(':courseId')
  @HttpCode(204)
  async remove(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    await this.courses.remove(req.user.id as string, courseId);
  }

  @Post(':courseId/join-code')
  async regenerateJoinCode(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.courses.regenerateJoinCode(req.user.id as string, courseId);
  }

  @Delete(':courseId/join-code')
  @HttpCode(204)
  async disableJoinCode(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    await this.courses.disableJoinCode(req.user.id as string, courseId);
  }

  // ── people ────────────────────────────────────────────────────────────────

  @Get(':courseId/people')
  async people(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.courses.people(req.user.id as string, courseId);
  }

  @Post(':courseId/staff')
  @HttpCode(204)
  async addStaff(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: AddCourseStaffDto,
  ) {
    await this.courses.addStaff(req.user.id as string, courseId, dto);
  }

  @Patch(':courseId/staff/:userProfileId')
  @HttpCode(204)
  async updateStaff(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('userProfileId', ParseUUIDPipe) userProfileId: string,
    @Body() dto: UpdateCourseStaffDto,
  ) {
    await this.courses.updateStaff(
      req.user.id as string,
      courseId,
      userProfileId,
      dto.role,
    );
  }

  @Delete(':courseId/staff/:userProfileId')
  @HttpCode(204)
  async removeStaff(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('userProfileId', ParseUUIDPipe) userProfileId: string,
  ) {
    await this.courses.removeStaff(
      req.user.id as string,
      courseId,
      userProfileId,
    );
  }

  @Post(':courseId/students')
  async enrollStudents(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: EnrollStudentsDto,
  ) {
    return this.courses.enrollStudents(
      req.user.id as string,
      courseId,
      dto.studentIds,
    );
  }

  @Delete(':courseId/students/:studentId')
  @HttpCode(204)
  async removeStudent(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    await this.courses.removeStudent(req.user.id as string, courseId, studentId);
  }
}
