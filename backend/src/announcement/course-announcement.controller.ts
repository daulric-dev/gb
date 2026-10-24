import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { AnnouncementService } from './announcement.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

/**
 * A course's own announcement stream. Gated by course role rather than the
 * `announcement` catalog permission: a TA posting to their course needs no
 * school-wide grant. The author edits or deletes their own post; the
 * course's teachers and admins can change anyone's.
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

  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.announcements.updateForCourse(
      req.user.id as string,
      courseId,
      id,
      dto,
    );
  }

  @Delete(':id')
  async delete(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.announcements.deleteForCourse(
      req.user.id as string,
      courseId,
      id,
    );
  }
}
