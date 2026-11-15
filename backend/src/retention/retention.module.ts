import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { RetentionScheduler } from './retention.scheduler';
import { SchoolRetentionService } from './school-retention.service';
import { SchoolRetentionController } from './school-retention.controller';

/**
 * Daily purge of expired soft-deleted data, sign-in leftovers and personal
 * data past its retention period; schools' own student-record retention.
 */
@Module({
  controllers: [SchoolRetentionController],
  providers: [RetentionService, RetentionScheduler, SchoolRetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
