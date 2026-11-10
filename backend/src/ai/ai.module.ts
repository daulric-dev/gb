import { Module } from '@nestjs/common';
import { OrganisationModule } from '@/organisation/organisation.module';
import { CourseModule } from '@/course/course.module';
import { GradingModule } from '@/grading/grading.module';
import { MasteryModule } from '@/mastery/mastery.module';
import {
  CourseAiController,
  CourseBuilderAiController,
  OrganisationAiController,
  SchoolAiController,
} from './ai.controller';
import { AiOrgFeatureGuard } from './ai-feature.guard';
import { AiProviderService } from './ai-provider.service';
import { AiService } from './ai.service';
import { AiDraftsService } from './ai-drafts.service';
import { AiCourseService } from './ai-course.service';

/**
 * AI assistance (feature `ai_assistance`): the organisation's own AI
 * providers, school settings, teacher drafts and the course builder.
 * OrganisationModule gives OrganisationAdminGuard; the course builder
 * creates through ModuleService / PageService (CourseModule), ActivityService
 * / AssignmentGroupService (GradingModule) and OutcomeService
 * (MasteryModule). CourseAccessService, FeatureService and AuditLogService
 * come from global modules.
 */
@Module({
  imports: [OrganisationModule, CourseModule, GradingModule, MasteryModule],
  controllers: [OrganisationAiController, SchoolAiController, CourseAiController, CourseBuilderAiController],
  providers: [AiOrgFeatureGuard, AiProviderService, AiService, AiDraftsService, AiCourseService],
})
export class AiModule {}
