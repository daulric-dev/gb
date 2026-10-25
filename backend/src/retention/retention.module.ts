import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { RetentionScheduler } from './retention.scheduler';

/** Daily purge of expired soft-deleted data and sign-in leftovers. */
@Module({
  providers: [RetentionService, RetentionScheduler],
  exports: [RetentionService],
})
export class RetentionModule {}
