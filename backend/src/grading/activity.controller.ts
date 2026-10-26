import {
  Body,
  Controller,
  Res,
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
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { ActivityService } from './activity.service';
import { SubmissionService } from './submission.service';
import {
  AddQuestionDto,
  CreateActivityDto,
  ExcuseSubmissionDto,
  GradeSubmissionDto,
  UpdateActivityDto,
  UpdateQuestionDto,
} from './dto/activity.dto';
import { contentDisposition } from './content-disposition';

/**
 * Teacher-facing quizzes, assignments and offline work.
 *
 * No catalog permission gates these: access is the caller's role in the
 * activity's course, checked by the services through CourseAccessService.
 * Teachers build and change work; TAs read it and mark.
 */
@ApiTags('Grading')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard)
export class ActivityController {
  constructor(
    private readonly activities: ActivityService,
    private readonly submissions: SubmissionService,
  ) {}

  @Get('courses/:courseId/activities')
  async list(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.activities.listForCourse(req.user.id as string, courseId);
  }

  @Post('courses/:courseId/activities')
  async create(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: CreateActivityDto,
  ) {
    return this.activities.create(req.user.id as string, courseId, dto);
  }

  /** The file a student handed in, for staff marking it. */
  @Get('activities/submissions/:submissionId/file')
  @ApiProduces('application/octet-stream')
  async submissionFile(
    @Req() req: any,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Res() res: FastifyReply,
  ) {
    const { buffer, contentType, filename } =
      await this.submissions.readSubmissionFile(
        req.user.id as string,
        submissionId,
      );

    return res
      .header('Content-Type', contentType ?? 'application/octet-stream')
      .header('Content-Disposition', contentDisposition('inline', filename))
      .header('Cache-Control', 'private, max-age=60')
      // Student-uploaded content on the API origin: never sniff it into HTML.
      .header('X-Content-Type-Options', 'nosniff')
      .send(buffer);
  }

  /** Marking by submission id, for a screen that already holds one. */
  @Post('activities/submissions/:submissionId/grade')
  async gradeSubmission(
    @Req() req: any,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: GradeSubmissionDto,
  ) {
    return this.submissions.gradeSubmission(
      req.user.id as string,
      submissionId,
      dto,
    );
  }

  @Get('activities/:activityId')
  async get(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
  ) {
    return this.activities.get(req.user.id as string, activityId);
  }

  @Patch('activities/:activityId')
  async update(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.activities.update(req.user.id as string, activityId, dto);
  }

  @Post('activities/:activityId/publish')
  async publish(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
  ) {
    return this.activities.publish(req.user.id as string, activityId);
  }

  @Post('activities/:activityId/close')
  async close(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
  ) {
    return this.activities.close(req.user.id as string, activityId);
  }

  @Delete('activities/:activityId')
  @HttpCode(204)
  async remove(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
  ) {
    await this.activities.remove(req.user.id as string, activityId);
  }

  // ── quiz questions ────────────────────────────────────────────────────────

  @Post('activities/:activityId/questions')
  async addQuestion(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() dto: AddQuestionDto,
  ) {
    return this.activities.addQuestion(req.user.id as string, activityId, dto);
  }

  @Patch('activities/:activityId/questions/:questionId')
  async updateQuestion(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.activities.updateQuestion(
      req.user.id as string,
      activityId,
      questionId,
      dto,
    );
  }

  @Delete('activities/:activityId/questions/:questionId')
  @HttpCode(204)
  async removeQuestion(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    await this.activities.removeQuestion(
      req.user.id as string,
      activityId,
      questionId,
    );
  }

  // ── marking ───────────────────────────────────────────────────────────────

  /** Every student on the roster, with their submission or lack of one. */
  @Get('activities/:activityId/submissions')
  async listSubmissions(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
  ) {
    return this.submissions.listForTeacher(req.user.id as string, activityId);
  }

  /**
   * Mark one student. Creates the submission when there is none, which is
   * how offline work and students who never handed in get a mark.
   */
  @Patch('activities/:activityId/submissions/:studentId/grade')
  async grade(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: GradeSubmissionDto,
  ) {
    return this.submissions.grade(
      req.user.id as string,
      activityId,
      studentId,
      dto,
    );
  }

  /** Leave one student's mark out of the course total, or put it back. */
  @Patch('activities/:activityId/submissions/:studentId/excuse')
  async excuse(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: ExcuseSubmissionDto,
  ) {
    return this.submissions.excuse(
      req.user.id as string,
      activityId,
      studentId,
      dto,
    );
  }
}
