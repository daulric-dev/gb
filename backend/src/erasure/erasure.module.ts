import { Global, Module } from '@nestjs/common';
import { ErasureLogService } from './erasure-log.service';
import { ErasureReplayService } from './erasure-replay.service';

/** The GDPR erasure log (global): every erasure path records into it. */
@Global()
@Module({
  providers: [ErasureLogService, ErasureReplayService],
  exports: [ErasureLogService, ErasureReplayService],
})
export class ErasureModule {}
