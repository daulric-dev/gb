import { Module } from '@nestjs/common';
import { FileManagerModule } from '@/file-manager/file-manager.module';
import { ImagesModule } from '@/images/images.module';
import { CourseBannerService } from './course-banner.service';
import { CourseController } from './course.controller';
import { CourseCopyController } from './course-copy.controller';
import { CourseCopyService } from './course-copy.service';
import { CourseFileController } from './course-file.controller';
import { CourseFileService } from './course-file.service';
import { CourseService } from './course.service';
import { ModuleController } from './module.controller';
import { ModuleService } from './module.service';
import { PageController } from './page.controller';
import { PageService } from './page.service';

@Module({
  imports: [FileManagerModule, ImagesModule],
  controllers: [
    CourseController,
    CourseCopyController,
    CourseFileController,
    ModuleController,
    PageController,
  ],
  providers: [
    CourseService,
    CourseBannerService,
    CourseCopyService,
    CourseFileService,
    ModuleService,
    PageService,
  ],
  // The portal enrols students by join code and shows published modules and
  // pages through these.
  exports: [CourseService, ModuleService, PageService],
})
export class CourseModule {}
