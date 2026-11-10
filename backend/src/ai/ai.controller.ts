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
import {
  AiOrgSettingsDto,
  AiSchoolSettingsDto,
  CreateAiProviderDto,
  PageSummaryDto,
  QuizDraftDto,
  RubricFeedbackDto,
  UpdateAiProviderDto,
} from './ai.dto';

type Req = { user: { id: string } };
const uuid = new ParseUUIDPipe();
/** Generating is slow and costs the organisation money: a tight per-session window on top of the hourly limit. */
const GENERATE_THROTTLE = { default: { limit: 10, ttl: 60 * 1000 } };

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
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
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
