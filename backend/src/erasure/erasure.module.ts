import { Global, Module } from '@nestjs/common';
import { ErasureLogService } from './erasure-log.service';
import { ErasureReplayService } from './erasure-replay.service';
import { StudentErasureService } from './student-erasure.service';
import { AccountErasureService } from './account-erasure.service';

/**
 * The GDPR erasure log (global): every erasure path records into it. Also
 * the shared erasures of a user account and of a student record, used by
 * the auth, organisation, student and retention modules.
 */
@Global()
@Module({
  providers: [ErasureLogService, ErasureReplayService, StudentErasureService, AccountErasureService],
  exports: [ErasureLogService, ErasureReplayService, StudentErasureService, AccountErasureService],
})
export class ErasureModule {}
