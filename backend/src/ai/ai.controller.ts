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
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@/auth/auth.guard';
import { RequireStepUp } from '@/auth/step-up.guard';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { AiOrgFeatureGuard } from './ai-feature.guard';
import { AiProviderService } from './ai-provider.service';
import { AiService } from './ai.service';
import { AiDraftsService } from './ai-drafts.service';
import { AiCourseService } from './ai-course.service';
import {
  AiOrgSettingsDto,
  AiSchoolSettingsDto,
  AnnouncementDraftDto,
  AssignmentDraftDto,
  CreateAiProviderDto,
  CreatePlanDto,
  ModuleItemsDraftDto,
  OutcomeSuggestDto,
  OutlineDraftDto,
  PageContentDraftDto,
  PageSummaryDto,
  QuizDraftDto,
  RubricDraftDto,
  RubricFeedbackDto,
  UpdateAiProviderDto,
} from './ai.dto';

type Req = { user: { id: string } };
const uuid = new ParseUUIDPipe();
/** Generating is slow and costs the organisation money: a tight per-session window on top of the hourly limit. */
const GENERATE_THROTTLE = { default: { limit: 10, ttl: 60 * 1000 } };
/** Creating a reviewed plan makes many rows: a few a minute is plenty. */
const CREATE_PLAN_THROTTLE = { default: { limit: 5, ttl: 60 * 1000 } };

/**
 * The organisation's AI providers and settings. Organisation admins only,
 * behind the organisation's `ai_assistance` switch; every write needs a
 * step-up confirmation and is audited.
 */
@ApiTags('AI assistance')
@ApiBearerAuth()
@UseGuards(AuthGuard, OrganisationAdminGuard, AiOrgFeatureGuard)
@Controller('organisation/ai')
export class OrganisationAiController {
  constructor(
    private readonly providers: AiProviderService,
    private readonly ai: AiService,
  ) {}

  @Get('providers')
  list() {
    return this.providers.list();
  }

  @RequireStepUp()
  @Post('providers')
  create(@Req() req: Req, @Body() dto: CreateAiProviderDto) {
    return this.providers.create(dto, req.user.id);
  }

  @RequireStepUp()
  @Patch('providers/:id')
  update(@Req() req: Req, @Param('id', uuid) id: string, @Body() dto: UpdateAiProviderDto) {
    return this.providers.update(id, dto, req.user.id);
  }

  @RequireStepUp()
  @Post('providers/:id/default')
  @HttpCode(200)
  setDefault(@Req() req: Req, @Param('id', uuid) id: string) {
    return this.providers.setDefault(id, req.user.id);
  }

  @RequireStepUp()
  @Delete('providers/:id')
  @HttpCode(204)
  async remove(@Req() req: Req, @Param('id', uuid) id: string) {
    await this.providers.remove(id, req.user.id);
  }

  // Calls the provider's saved endpoint (SSRF-guarded); rate-limited so it can't probe hosts.
  @Throttle({ route: { limit: 10, ttl: 60 * 1000 } })
  @Post('providers/:id/test')
  @HttpCode(200)
  test(@Req() req: Req, @Param('id', uuid) id: string) {
    return this.ai.testProvider(id, req.user.id);
  }

  @Get('settings')
  settings() {
    return this.providers.orgSettings();
  }

  @RequireStepUp()
  @Put('settings')
  updateSettings(@Req() req: Req, @Body() dto: AiOrgSettingsDto) {
    return this.providers.updateOrgSettings(dto, req.user.id);
  }

  @Get('usage')
  usage() {
    return this.providers.usage();
  }
}

/** The active school's AI settings (`school:update`); 403 while `ai_assistance` is off for it. */
@ApiTags('AI assistance')
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller('schools/current/ai')
export class SchoolAiController {
  constructor(private readonly ai: AiService) {}

  @RequirePermission('school', 'update')
  @Get()
  get(@Req() req: Req) {
    return this.ai.getSchoolSettings(req.user.id);
  }

  @RequirePermission('school', 'update')
  @Put()
  update(@Req() req: Req, @Body() dto: AiSchoolSettingsDto) {
    return this.ai.updateSchoolSettings(req.user.id, dto);
  }
}

/**
 * Teacher drafts. Staff of the course (manage roles to draft questions or a
 * summary; any staff role for marking suggestions), `ai_assistance` on for
 * the course's school (checked by the service). Every route returns drafts
 * only: nothing is saved until the teacher accepts it through the normal
 * routes.
 */
@ApiTags('AI assistance')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class CourseAiController {
  constructor(private readonly drafts: AiDraftsService) {}

  @Get('courses/:courseId/ai')
  status(@Req() req: Req, @Param('courseId', uuid) courseId: string) {
    return this.drafts.status(req.user.id, courseId);
  }

  @Throttle(GENERATE_THROTTLE)
  @Post('courses/:courseId/ai/quiz-questions')
  @HttpCode(200)
  quiz(@Req() req: Req, @Param('courseId', uuid) courseId: string, @Body() dto: QuizDraftDto) {
    return this.drafts.quizQuestions(req.user.id, courseId, dto);
  }

  @Throttle(GENERATE_THROTTLE)
  @Post('courses/:courseId/pages/:pageId/ai/summary')
  @HttpCode(200)
  summary(
    @Req() req: Req,
    @Param('courseId', uuid) courseId: string,
    @Param('pageId', uuid) pageId: string,
    @Body() dto: PageSummaryDto,
  ) {
    return this.drafts.pageSummary(req.user.id, courseId, pageId, dto);
  }

  @Throttle(GENERATE_THROTTLE)
  @Post('activities/:activityId/ai/rubric-feedback')
  @HttpCode(200)
  rubric(@Req() req: Req, @Param('activityId', uuid) activityId: string, @Body() dto: RubricFeedbackDto) {
    return this.drafts.rubricFeedback(req.user.id, activityId, dto);
  }
}

/**
 * The AI course builder. Course teachers and admins (not TAs; announcement
 * drafts follow announcement permissions, so TAs too), `ai_assistance` on
 * for the course's school (checked by the service). Every `ai/...` route
 * returns drafts only and sends teacher material only (no student data).
 * The one route that creates anything is `ai/plan/create`, with the plan
 * the teacher reviewed; everything it creates starts unpublished.
 */
@ApiTags('AI assistance')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('courses/:courseId')
export class CourseBuilderAiController {
  constructor(private readonly builder: AiCourseService) {}

  @Throttle(GENERATE_THROTTLE)
  @Post('ai/outline')
  @HttpCode(200)
  outline(@Req() req: Req, @Param('courseId', uuid) courseId: string, @Body() dto: OutlineDraftDto) {
    return this.builder.outline(req.user.id, courseId, dto);
  }

  @Throttle(CREATE_PLAN_THROTTLE)
  @Post('ai/plan/create')
  @HttpCode(200)
  createPlan(@Req() req: Req, @Param('courseId', uuid) courseId: string, @Body() dto: CreatePlanDto) {
    return this.builder.createFromPlan(req.user.id, courseId, dto);
  }

  @Throttle(GENERATE_THROTTLE)
  @Post('modules/:moduleId/ai/items')
  @HttpCode(200)
  moduleItems(
    @Req() req: Req,
    @Param('courseId', uuid) courseId: string,
    @Param('moduleId', uuid) moduleId: string,
    @Body() dto: ModuleItemsDraftDto,
  ) {
    return this.builder.moduleItems(req.user.id, courseId, moduleId, dto);
  }

  @Throttle(GENERATE_THROTTLE)
  @Post('ai/page-content')
  @HttpCode(200)
  pageContent(@Req() req: Req, @Param('courseId', uuid) courseId: string, @Body() dto: PageContentDraftDto) {
    return this.builder.pageContent(req.user.id, courseId, dto);
  }

  @Throttle(GENERATE_THROTTLE)
  @Post('ai/assignment-instructions')
  @HttpCode(200)
  assignment(@Req() req: Req, @Param('courseId', uuid) courseId: string, @Body() dto: AssignmentDraftDto) {
    return this.builder.assignmentInstructions(req.user.id, courseId, dto);
  }

  @Throttle(GENERATE_THROTTLE)
  @Post('ai/rubric')
  @HttpCode(200)
  rubric(@Req() req: Req, @Param('courseId', uuid) courseId: string, @Body() dto: RubricDraftDto) {
    return this.builder.rubricDraft(req.user.id, courseId, dto);
  }

  @Throttle(GENERATE_THROTTLE)
  @Post('ai/announcement')
  @HttpCode(200)
  announcement(@Req() req: Req, @Param('courseId', uuid) courseId: string, @Body() dto: AnnouncementDraftDto) {
    return this.builder.announcement(req.user.id, courseId, dto);
  }

  @Throttle(GENERATE_THROTTLE)
  @Post('ai/outcomes')
  @HttpCode(200)
  outcomes(@Req() req: Req, @Param('courseId', uuid) courseId: string, @Body() dto: OutcomeSuggestDto) {
    return this.builder.suggestOutcomes(req.user.id, courseId, dto);
  }
}
