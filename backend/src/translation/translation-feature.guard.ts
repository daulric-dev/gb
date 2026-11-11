import { CanActivate, Injectable } from '@nestjs/common';
import { FeatureService } from '@/features/feature.service';

/**
 * The organisation console's translation routes check `translation` against
 * the organisation's own setting (no school): 403 `FEATURE_DISABLED` while
 * the organisation has it off. Runs after AuthGuard and
 * OrganisationAdminGuard. The user routes check the caller's (or the
 * course's) school in TranslationService instead.
 */
@Injectable()
export class TranslationOrgFeatureGuard implements CanActivate {
  constructor(private readonly features: FeatureService) {}

  async canActivate(): Promise<boolean> {
    await this.features.assertEnabled(null, 'translation');
    return true;
  }
}
