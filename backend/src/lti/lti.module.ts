import { Module } from '@nestjs/common';
import { GradingModule } from '@/grading/grading.module';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { PlatformKeyService } from './platform-key.service';
import { ToolKeyService } from './tool-key.service';
import { LtiToolService } from './lti-tool.service';
import { LtiLinkService } from './lti-link.service';
import { LtiLaunchService } from './lti-launch.service';
import { LtiRateLimiter, LtiTokenService } from './lti-token.service';
import { LtiAgsService } from './lti-ags.service';
import {
  LtiAdminController,
  LtiAgsController,
  LtiAgsGuard,
  LtiCourseController,
  LtiOrganisationFeatureGuard,
  LtiPublicController,
} from './lti.controllers';

/**
 * LTI 1.3 tool support with GradeBook as the platform (behind the `lti`
 * feature). See README.md.
 */
@Module({
  imports: [GradingModule],
  controllers: [LtiAdminController, LtiCourseController, LtiPublicController, LtiAgsController],
  providers: [
    PlatformKeyService,
    ToolKeyService,
    LtiToolService,
    LtiLinkService,
    LtiLaunchService,
    LtiTokenService,
    LtiRateLimiter,
    LtiAgsService,
    LtiAgsGuard,
    LtiOrganisationFeatureGuard,
    OrganisationAdminGuard,
  ],
})
export class LtiModule {}
