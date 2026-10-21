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
import { AnnouncementService } from './announcement.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

/**
 * A course's own announcement stream. Gated by course role rather than the
 * `announcement` catalog permission: a TA posting to their course needs no
 * school-wide grant. Editing and deleting go through `/announcements/:id`
 * (author or school admin), the same as school notices.
 */
@ApiTags('Announcements')
@ApiBearerAuth()
@Controller('courses/:courseId/announcements')
@UseGuards(AuthGuard)
export class CourseAnnouncementController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get()
  async list(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.announcements.findForCourse(req.user.id as string, courseId);
  }

  @Post()
  async create(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.announcements.createForCourse(
      req.user.id as string,
      courseId,
      dto,
    );
  }
}
