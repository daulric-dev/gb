import { Module } from '@nestjs/common';
import {
  EmailDomainController,
  EmailDomainJoinController,
} from './email-domain.controller';
import { EmailDomainService } from './email-domain.service';

@Module({
  controllers: [EmailDomainController, EmailDomainJoinController],
  providers: [EmailDomainService],
  // Onboarding joins a matching school as soon as the profile is complete.
  exports: [EmailDomainService],
})
export class EmailDomainModule {}
