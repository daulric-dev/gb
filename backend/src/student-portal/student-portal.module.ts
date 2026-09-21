import { Module } from '@nestjs/common';
import { GradingModule } from '@/grading/grading.module';
import { StudentPortalController } from './student-portal.controller';
import { StudentPortalService } from './student-portal.service';
import { StudentGuard } from './student.guard';
import { PortalActivityController } from './portal-activity.controller';

@Module({
  imports: [GradingModule],
  controllers: [StudentPortalController, PortalActivityController],
  providers: [StudentPortalService, StudentGuard],
  exports: [StudentGuard],
})
export class StudentPortalModule {}
