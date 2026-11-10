import { Module } from '@nestjs/common';
import { OrganisationModule } from '@/organisation/organisation.module';
import { CourseAiController, OrganisationAiController, SchoolAiController } from './ai.controller';
import { AiOrgFeatureGuard } from './ai-feature.guard';
import { AiProviderService } from './ai-provider.service';
import { AiService } from './ai.service';
import { AiDraftsService } from './ai-drafts.service';

/**
 * AI assistance (feature `ai_assistance`): the organisation's own AI
 * providers, school settings and teacher drafts. OrganisationModule gives
 * OrganisationAdminGuard; CourseAccessService, FeatureService and
 * AuditLogService come from global modules.
 */
@Module({
  imports: [OrganisationModule],
  controllers: [OrganisationAiController, SchoolAiController, CourseAiController],
  providers: [AiOrgFeatureGuard, AiProviderService, AiService, AiDraftsService],
})
export class AiModule {}
