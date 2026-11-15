import { Module } from '@nestjs/common';
import { FileManagerModule } from '@/file-manager/file-manager.module';
import { PastoralController } from './pastoral.controller';
import { PastoralService } from './pastoral.service';
import { SensitiveTextBackfillService } from '@/account/sensitive-text-backfill.service';

/**
 * Behaviour and pastoral notes. Exports nothing on purpose: no other module
 * (portal, parent portal, report cards, webhooks, LTI) can read the notes.
 * Also runs the boot-time encryption of stored note text and accommodation
 * reasons (SensitiveTextBackfillService).
 */
@Module({
  imports: [FileManagerModule],
  controllers: [PastoralController],
  providers: [PastoralService, SensitiveTextBackfillService],
})
export class PastoralModule {}
