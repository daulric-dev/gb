import { Global, Module } from '@nestjs/common';
import { FeatureService } from './feature.service';
import { FeatureGuard } from './feature.guard';

/**
 * Platform features the organisation switches on or off (and schools may
 * switch off). Global: guards and services across the app check them.
 */
@Global()
@Module({
  providers: [FeatureService, FeatureGuard],
  exports: [FeatureService, FeatureGuard],
})
export class FeaturesModule {}
