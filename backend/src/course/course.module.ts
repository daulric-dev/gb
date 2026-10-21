import { Module } from '@nestjs/common';
import { CourseController } from './course.controller';
import { CourseService } from './course.service';
import { ModuleController } from './module.controller';
import { ModuleService } from './module.service';
import { PageController } from './page.controller';
import { PageService } from './page.service';

@Module({
  controllers: [CourseController, ModuleController, PageController],
  providers: [CourseService, ModuleService, PageService],
  // The portal enrols students by join code and shows published modules and
  // pages through these.
  exports: [CourseService, ModuleService, PageService],
})
export class CourseModule {}
