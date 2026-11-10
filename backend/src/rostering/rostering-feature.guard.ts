import { CanActivate, Injectable } from '@nestjs/common';
import { FeatureService } from '@/features/feature.service';

/**
 * `rostering` is an organisation-level feature: checked against the
 * organisation's own setting (no school), so a school's switch never
 * affects it. 403 `FEATURE_DISABLED` while it is off. Runs after
 * AuthGuard and OrganisationAdminGuard.
 */
@Injectable()
export class RosteringFeatureGuard implements CanActivate {
  constructor(private readonly features: FeatureService) {}

  async canActivate(): Promise<boolean> {
    await this.features.assertEnabled(null, 'rostering');
    return true;
  }
}
