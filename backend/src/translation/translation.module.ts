import { Module } from '@nestjs/common';
import { OrganisationModule } from '@/organisation/organisation.module';
import { GradingModule } from '@/grading/grading.module';
import {
  ActivityTranslationController,
  OrganisationTranslationController,
  TranslationController,
} from './translation.controller';
import { TranslationOrgFeatureGuard } from './translation-feature.guard';
import { TranslationSettingsService } from './translation-settings.service';
import { TranslationService } from './translation.service';
import { ActivityTranslationService } from './activity-translation.service';

/**
 * Machine translation (feature `translation`): the organisation's engine
 * settings, translation for signed-in users and translated activity copies.
 * OrganisationModule gives OrganisationAdminGuard, GradingModule
 * ActivityService. CacheService, FeatureService, CourseAccessService and
 * AuditLogService come from global modules.
 */
@Module({
  imports: [OrganisationModule, GradingModule],
  controllers: [OrganisationTranslationController, TranslationController, ActivityTranslationController],
  providers: [TranslationOrgFeatureGuard, TranslationSettingsService, TranslationService, ActivityTranslationService],
})
export class TranslationModule {}
