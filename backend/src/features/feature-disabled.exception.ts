import { ForbiddenException } from '@nestjs/common';
import { featureDefinition, type FeatureKey } from './feature.catalog';

export const FEATURE_DISABLED = 'FEATURE_DISABLED';

/**
 * 403 for a feature that is off where the caller is. The body carries a
 * stable `code` and the feature key so clients can tell it from a missing
 * permission:
 * `{ statusCode: 403, code: 'FEATURE_DISABLED', feature, message }`.
 */
export class FeatureDisabledException extends ForbiddenException {
  constructor(readonly feature: FeatureKey) {
    super({
      statusCode: 403,
      code: FEATURE_DISABLED,
      feature,
      message: `${featureDefinition(feature).label} is turned off for your school`,
    });
  }
}
