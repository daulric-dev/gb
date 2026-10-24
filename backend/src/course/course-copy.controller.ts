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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { CourseCopyService } from './course-copy.service';
import { CopyCourseDto, ImportCourseContentDto } from './dto/course-copy.dto';

/**
 * Copying courses and starting from templates.
 *
 * Listing templates and copying into a new course make a course, so they are
 * gated by `course:create` like creating one; importing into an existing
 * course is decided by the caller's role in it.
 */
@ApiTags('Courses')
@ApiBearerAuth()
@Controller('courses')
@UseGuards(AuthGuard, PermissionGuard)
export class CourseCopyController {
  constructor(private readonly copies: CourseCopyService) {}

  @RequirePermission('course', 'create')
  @Get('templates')
  async templates(@Req() req: any) {
    return this.copies.listTemplates(req.user.id as string);
  }

  @RequirePermission('course', 'create')
  @Post(':courseId/copy')
  async copy(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: CopyCourseDto,
  ) {
    return this.copies.copy(req.user.id as string, courseId, dto);
  }

  @Post(':courseId/import')
  async importContent(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: ImportCourseContentDto,
  ) {
    return this.copies.importInto(req.user.id as string, courseId, dto);
  }
}
