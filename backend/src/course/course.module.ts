import { Module } from '@nestjs/common';
import { CourseController } from './course.controller';
import { CourseCopyController } from './course-copy.controller';
import { CourseCopyService } from './course-copy.service';
import { CourseService } from './course.service';
import { ModuleController } from './module.controller';
import { ModuleService } from './module.service';
import { PageController } from './page.controller';
import { PageService } from './page.service';

@Module({
  controllers: [
    CourseController,
    CourseCopyController,
    ModuleController,
    PageController,
  ],
  providers: [CourseService, CourseCopyService, ModuleService, PageService],
  // The portal enrols students by join code and shows published modules and
  // pages through these.
  exports: [CourseService, ModuleService, PageService],
})
export class CourseModule {}
