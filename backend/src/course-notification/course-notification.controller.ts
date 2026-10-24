import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import {
  StudentGuard,
  type StudentRequest,
} from '@/student-portal/student.guard';
import { CourseNotificationService } from './course-notification.service';
import {
  ListCourseNotificationsQueryDto,
  MarkCourseNotificationsReadDto,
} from './dto/course-notification.dto';

/**
 * A student's notices about their courses: new work and announcements.
 * Notices belong to the signed-in account; there is no id to pass.
 */
@ApiTags('Student Portal')
@ApiBearerAuth()
@Controller('portal/me/notifications')
@UseGuards(AuthGuard, StudentGuard)
export class CourseNotificationController {
  constructor(private readonly notifications: CourseNotificationService) {}

  @Get()
  async list(
    @Req() req: StudentRequest,
    @Query() query: ListCourseNotificationsQueryDto,
  ) {
    return this.notifications.list(req.user!.id, query);
  }

  @Get('unread-count')
  async unreadCount(@Req() req: StudentRequest) {
    return this.notifications.unreadCount(req.user!.id);
  }

  @Post('read')
  @HttpCode(204)
  async markRead(
    @Req() req: StudentRequest,
    @Body() dto: MarkCourseNotificationsReadDto,
  ) {
    await this.notifications.markRead(req.user!.id, dto.ids);
  }

  @Post('read-all')
  @HttpCode(204)
  async markAllRead(@Req() req: StudentRequest) {
    await this.notifications.markAllRead(req.user!.id);
  }
}
