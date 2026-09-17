import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import { ActivityService } from './activity.service';
import { SubmissionService } from './submission.service';
import {
  AddQuestionDto,
  CreateActivityDto,
  GradeSubmissionDto,
  ListActivitiesQueryDto,
  UpdateActivityDto,
} from './dto/activity.dto';

/**
 * Teacher-facing quizzes and assignments.
 *
 * Gated on the assessment permissions: an activity becomes an assessment when
 * published, so the same people who manage assessments manage these.
 */
@ApiTags('Grading')
@ApiBearerAuth()
@Controller('activities')
@UseGuards(AuthGuard, PermissionGuard)
export class ActivityController {
  constructor(
    private readonly activities: ActivityService,
    private readonly submissions: SubmissionService,
  ) {}

  @RequirePermission('assessment', 'read')
  @Get()
  async list(@Req() req: any, @Query() query: ListActivitiesQueryDto) {
    return this.activities.list(req.user.id as string, query);
  }

  @RequirePermission('assessment', 'read')
  @Get(':activityId')
  async get(@Req() req: any, @Param('activityId') activityId: string) {
    return this.activities.get(req.user.id as string, activityId);
  }

  @RequirePermission('assessment', 'create')
  @Post()
  async create(@Req() req: any, @Body() dto: CreateActivityDto) {
    return this.activities.create(req.user.id as string, dto);
  }

  @RequirePermission('assessment', 'update')
  @Patch(':activityId')
  async update(
    @Req() req: any,
    @Param('activityId') activityId: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.activities.update(req.user.id as string, activityId, dto);
  }

  /** Creates the gradebook row and opens the activity to students. */
  @RequirePermission('assessment', 'update')
  @Post(':activityId/publish')
  async publish(@Req() req: any, @Param('activityId') activityId: string) {
    return this.activities.publish(req.user.id as string, activityId);
  }

  @RequirePermission('assessment', 'update')
  @Post(':activityId/close')
  async close(@Req() req: any, @Param('activityId') activityId: string) {
    return this.activities.close(req.user.id as string, activityId);
  }

  @RequirePermission('assessment', 'delete')
  @Delete(':activityId')
  @HttpCode(204)
  async remove(@Req() req: any, @Param('activityId') activityId: string) {
    await this.activities.remove(req.user.id as string, activityId);
  }

  // ── quiz questions ────────────────────────────────────────────────────────

  @RequirePermission('assessment', 'update')
  @Post(':activityId/questions')
  async addQuestion(
    @Req() req: any,
    @Param('activityId') activityId: string,
    @Body() dto: AddQuestionDto,
  ) {
    return this.activities.addQuestion(req.user.id as string, activityId, dto);
  }

  @RequirePermission('assessment', 'update')
  @Delete(':activityId/questions/:questionId')
  @HttpCode(204)
  async removeQuestion(
    @Req() req: any,
    @Param('activityId') activityId: string,
    @Param('questionId') questionId: string,
  ) {
    await this.activities.removeQuestion(
      req.user.id as string,
      activityId,
      questionId,
    );
  }

  // ── marking ───────────────────────────────────────────────────────────────

  /** Every student in the class, with their submission or lack of one. */
  @RequirePermission('grade', 'read')
  @Get(':activityId/submissions')
  async submissions_(
    @Req() req: any,
    @Param('activityId') activityId: string,
  ) {
    return this.submissions.listForTeacher(req.user.id as string, activityId);
  }

  @RequirePermission('grade', 'update')
  @Post('submissions/:submissionId/grade')
  async grade(
    @Req() req: any,
    @Param('submissionId') submissionId: string,
    @Body() dto: GradeSubmissionDto,
  ) {
    return this.submissions.grade(req.user.id as string, submissionId, dto);
  }
}
