import { Global, Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { EmailCodeService } from './email-code.service';
import { SessionService } from './session.service';
import { SessionAlertService } from './session-alert.service';

/**
 * Our own authentication: users, sessions and email sign-in codes. Global,
 * because every guarded route resolves the session.
 */
@Global()
@Module({
  providers: [AccountService, EmailCodeService, SessionService, SessionAlertService],
  exports: [AccountService, EmailCodeService, SessionService],
})
export class AccountModule {}
