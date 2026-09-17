import { Module } from '@nestjs/common';
import { StudentClaimController } from './student-claim.controller';
import { SchoolJoinCodeController } from './school-join-code.controller';
import { StudentClaimService } from './student-claim.service';

@Module({
  controllers: [StudentClaimController, SchoolJoinCodeController],
  providers: [StudentClaimService],
  // AuthModule redeems codes during the student onboarding flow.
  exports: [StudentClaimService],
})
export class StudentAccountModule {}
