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
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { DiscussionService } from './discussion.service';
import {
  CreateReplyDto,
  CreateTopicDto,
  UpdateDiscussionSettingsDto,
  UpdateReplyDto,
  UpdateTopicDto,
} from './dto/discussion.dto';

/**
 * A course's discussions, staff side. Gated by course role: any staff
 * member reads, starts topics and replies; teachers and admins moderate.
 */
@ApiTags('Discussions')
@ApiBearerAuth()
@Controller('courses/:courseId/discussions')
@UseGuards(AuthGuard)
export class DiscussionController {
  constructor(private readonly discussions: DiscussionService) {}

  @Get()
  async list(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    const ctx = await this.discussions.forStaff(req.user.id as string, courseId);
    return this.discussions.list(ctx);
  }

  @Get('settings')
  async settings(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    const ctx = await this.discussions.forStaff(req.user.id as string, courseId);
    return this.discussions.getSettings(ctx);
  }

  @Put('settings')
  async updateSettings(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: UpdateDiscussionSettingsDto,
  ) {
    const ctx = await this.discussions.forStaff(req.user.id as string, courseId);
    return this.discussions.updateSettings(ctx, dto.studentsCanCreateTopics);
  }

  @Post()
  async create(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: CreateTopicDto,
  ) {
    const ctx = await this.discussions.forStaff(req.user.id as string, courseId);
    return this.discussions.create(ctx, dto);
  }

  @Get(':topicId')
  async get(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('topicId', ParseUUIDPipe) topicId: string,
  ) {
    const ctx = await this.discussions.forStaff(req.user.id as string, courseId);
    return this.discussions.get(ctx, topicId);
  }

  @Patch(':topicId')
  async update(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Body() dto: UpdateTopicDto,
  ) {
    const ctx = await this.discussions.forStaff(req.user.id as string, courseId);
    return this.discussions.update(ctx, topicId, dto);
  }

  @Delete(':topicId')
  @HttpCode(204)
  async remove(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('topicId', ParseUUIDPipe) topicId: string,
  ) {
    const ctx = await this.discussions.forStaff(req.user.id as string, courseId);
    await this.discussions.remove(ctx, topicId);
  }

  @Post(':topicId/replies')
  async reply(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Body() dto: CreateReplyDto,
  ) {
    const ctx = await this.discussions.forStaff(req.user.id as string, courseId);
    return this.discussions.reply(ctx, topicId, dto);
  }

  @Patch(':topicId/replies/:replyId')
  async updateReply(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Param('replyId', ParseUUIDPipe) replyId: string,
    @Body() dto: UpdateReplyDto,
  ) {
    const ctx = await this.discussions.forStaff(req.user.id as string, courseId);
    return this.discussions.updateReply(ctx, topicId, replyId, dto);
  }

  @Delete(':topicId/replies/:replyId')
  @HttpCode(204)
  async removeReply(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Param('replyId', ParseUUIDPipe) replyId: string,
  ) {
    const ctx = await this.discussions.forStaff(req.user.id as string, courseId);
    await this.discussions.removeReply(ctx, topicId, replyId);
  }
}
