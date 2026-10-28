import { Module } from '@nestjs/common';
import { SchoolJoinCodeController } from './school-join-code.controller';
import { StudentMembershipService } from './student-membership.service';

@Module({
  controllers: [SchoolJoinCodeController],
  providers: [StudentMembershipService],
  // AuthModule redeems the join code during student onboarding.
  exports: [StudentMembershipService],
})
export class StudentAccountModule {}
