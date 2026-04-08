import { Module } from '@nestjs/common';
import { ClassController } from './class.controller';
import { ClassService } from './class.service';
import { ClassTeacherGuard } from './class-teacher.guard';

@Module({
  controllers: [ClassController],
  providers: [ClassService, ClassTeacherGuard],
  exports: [ClassTeacherGuard],
})
export class ClassModule {}