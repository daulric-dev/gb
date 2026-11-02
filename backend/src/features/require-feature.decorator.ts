import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from './feature.catalog';

export const FEATURE_KEY = 'required_features';

/**
 * Declares the platform features a route needs. Read by FeatureGuard, which
 * answers 403 FEATURE_DISABLED when any of them is off for the caller's
 * school. A method's list replaces the controller's.
 *
 * @example
 *   @UseGuards(AuthGuard, FeatureGuard)
 *   @RequireFeature('attendance')
 *   @Controller('courses/:courseId/attendance')
 */
export const RequireFeature = (...keys: FeatureKey[]) =>
  SetMetadata<string, FeatureKey[]>(FEATURE_KEY, keys);
