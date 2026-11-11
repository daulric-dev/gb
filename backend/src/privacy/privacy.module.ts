import { Module } from '@nestjs/common';
import { OrganisationModule } from '@/organisation/organisation.module';
import { OrganisationPrivacyController, PrivacyNoticeController } from './privacy.controller';
import { PrivacyService } from './privacy.service';

/**
 * The privacy notice (GDPR Art 13/14): the organisation's controller
 * details and the public notice built from them and the live
 * configuration. OrganisationModule gives OrganisationAdminGuard;
 * PrismaService, FeatureService, CacheService and AuditLogService come from
 * global modules.
 */
@Module({
  imports: [OrganisationModule],
  controllers: [PrivacyNoticeController, OrganisationPrivacyController],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
