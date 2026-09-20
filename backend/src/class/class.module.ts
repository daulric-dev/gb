import { Module } from '@nestjs/common';
import { ClassController } from './class.controller';
import { ClassService } from './class.service';
import { ClassMemberGuard, ClassTeacherGuard } from './class-teacher.guard';

@Module({
  controllers: [ClassController],
  providers: [ClassService, ClassTeacherGuard, ClassMemberGuard],
  exports: [ClassTeacherGuard, ClassMemberGuard],
})
export class ClassModule {}
