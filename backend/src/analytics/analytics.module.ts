import { Module } from '@nestjs/common';
import { AnalyticsController, CourseAnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsScheduler } from './analytics.scheduler';

/**
 * Course and school analytics. Prisma, cache, features, permissions and
 * course access are global.
 */
@Module({
  controllers: [AnalyticsController, CourseAnalyticsController],
  providers: [AnalyticsService, AnalyticsScheduler],
})
export class AnalyticsModule {}
