import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { MeController } from './me.controller';
import { ActiveSchoolService } from './active-school.service';
import { StepUpController } from './step-up.controller';
import { StepUpService } from './step-up.service';
import { ImagesModule } from '@/images/images.module';
import { StudentAccountModule } from '@/student-account/student-account.module';
import { EmailDomainModule } from '@/email-domain/email-domain.module';

@Module({
  imports: [ImagesModule, StudentAccountModule, EmailDomainModule],
  controllers: [AuthController, MeController, StepUpController],
  providers: [AuthService, AuthGuard, ActiveSchoolService, StepUpService],
  exports: [AuthGuard],
})
export class AuthModule {}
