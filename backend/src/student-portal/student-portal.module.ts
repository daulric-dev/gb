import { Module } from '@nestjs/common';
import { StudentPortalController } from './student-portal.controller';
import { StudentPortalService } from './student-portal.service';
import { StudentGuard } from './student.guard';

@Module({
  controllers: [StudentPortalController],
  providers: [StudentPortalService, StudentGuard],
  exports: [StudentGuard],
})
export class StudentPortalModule {}
