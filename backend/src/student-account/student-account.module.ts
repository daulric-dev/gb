import { Module } from '@nestjs/common';
import { StudentClaimController } from './student-claim.controller';
import { StudentClaimService } from './student-claim.service';

@Module({
  controllers: [StudentClaimController],
  providers: [StudentClaimService],
  // AuthModule redeems codes during the student onboarding flow.
  exports: [StudentClaimService],
})
export class StudentAccountModule {}
