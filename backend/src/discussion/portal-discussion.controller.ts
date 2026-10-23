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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import {
  StudentGuard,
  type StudentRequest,
} from '@/student-portal/student.guard';
import { DiscussionService } from './discussion.service';
import {
  CreateReplyDto,
  CreateTopicDto,
  UpdateReplyDto,
  UpdateTopicDto,
} from './dto/discussion.dto';

/**
 * A student's side of course discussions. The student is the one
 * StudentGuard resolved; they post as their own account and can only change
 * their own posts. Archived courses are read-only.
 */
@ApiTags('Student Portal')
@ApiBearerAuth()
@Controller('portal/me/courses/:courseId/discussions')
@UseGuards(AuthGuard, StudentGuard)
export class PortalDiscussionController {
  constructor(private readonly discussions: DiscussionService) {}

  private ctx(req: StudentRequest, courseId: string) {
    return this.discussions.forStudent(
      req.user!.id,
      req.student!.studentId,
      courseId,
    );
  }

  @Get()
  async list(
    @Req() req: StudentRequest,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.discussions.list(await this.ctx(req, courseId));
  }

  /** Only when the course lets students start topics. */
  @Post()
  async create(
    @Req() req: StudentRequest,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: CreateTopicDto,
  ) {
    return this.discussions.create(await this.ctx(req, courseId), dto);
  }

  @Get(':topicId')
  async get(
    @Req() req: StudentRequest,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('topicId', ParseUUIDPipe) topicId: string,
  ) {
    return this.discussions.get(await this.ctx(req, courseId), topicId);
  }

  @Patch(':topicId')
  async update(
    @Req() req: StudentRequest,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Body() dto: UpdateTopicDto,
  ) {
    return this.discussions.update(await this.ctx(req, courseId), topicId, dto);
  }

  @Delete(':topicId')
  @HttpCode(204)
  async remove(
    @Req() req: StudentRequest,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('topicId', ParseUUIDPipe) topicId: string,
  ) {
    await this.discussions.remove(await this.ctx(req, courseId), topicId);
  }

  @Post(':topicId/replies')
  async reply(
    @Req() req: StudentRequest,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Body() dto: CreateReplyDto,
  ) {
    return this.discussions.reply(await this.ctx(req, courseId), topicId, dto);
  }

  @Patch(':topicId/replies/:replyId')
  async updateReply(
    @Req() req: StudentRequest,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Param('replyId', ParseUUIDPipe) replyId: string,
    @Body() dto: UpdateReplyDto,
  ) {
    return this.discussions.updateReply(
      await this.ctx(req, courseId),
      topicId,
      replyId,
      dto,
    );
  }

  @Delete(':topicId/replies/:replyId')
  @HttpCode(204)
  async removeReply(
    @Req() req: StudentRequest,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Param('replyId', ParseUUIDPipe) replyId: string,
  ) {
    await this.discussions.removeReply(
      await this.ctx(req, courseId),
      topicId,
      replyId,
    );
  }
}
