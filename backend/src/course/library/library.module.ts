import { Logger, Module, type DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CourseModule } from '../course.module';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';
import { LibraryImportService } from './library-import.service';
import { LibraryImportScheduler } from './library-import.scheduler';
import { LibraryImportProcessor } from './library-import.processor';
import { QUEUE_LIBRARY_IMPORT } from './library.constants';

/**
 * The course template library. With Redis (USE_REDIS=true and REDIS_URL,
 * sharing QueueModule's BullModule connection) imports run on the
 * `course-library-import` queue; otherwise in-process after the request.
 */
@Module({})
export class CourseLibraryModule {
  static forRoot(): DynamicModule {
    const useRedis = process.env.USE_REDIS === 'true' && !!process.env.REDIS_URL;
    if (!useRedis) {
      new Logger(CourseLibraryModule.name).log('Redis disabled — library imports run in-process');
    }
    return {
      module: CourseLibraryModule,
      imports: [
        CourseModule,
        ...(useRedis ? [BullModule.registerQueue({ name: QUEUE_LIBRARY_IMPORT })] : []),
      ],
      controllers: [LibraryController],
      providers: [
        LibraryService,
        LibraryImportService,
        LibraryImportScheduler,
        ...(useRedis ? [LibraryImportProcessor] : []),
      ],
    };
  }
}
