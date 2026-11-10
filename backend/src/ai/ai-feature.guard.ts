import { CanActivate, Injectable } from '@nestjs/common';
import { FeatureService } from '@/features/feature.service';

/**
 * The organisation console's AI routes check `ai_assistance` against the
 * organisation's own setting (no school): 403 `FEATURE_DISABLED` while the
 * organisation has it off. Runs after AuthGuard and OrganisationAdminGuard.
 * Teacher and school routes check the course's or school's effective value
 * in the services instead.
 */
@Injectable()
export class AiOrgFeatureGuard implements CanActivate {
  constructor(private readonly features: FeatureService) {}

  async canActivate(): Promise<boolean> {
    await this.features.assertEnabled(null, 'ai_assistance');
    return true;
  }
}
