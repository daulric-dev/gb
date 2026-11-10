import { Module } from '@nestjs/common';
import { FileManagerModule } from '@/file-manager/file-manager.module';
import { PastoralController } from './pastoral.controller';
import { PastoralService } from './pastoral.service';

/**
 * Behaviour and pastoral notes. Exports nothing on purpose: no other module
 * (portal, parent portal, report cards, webhooks, LTI) can read the notes.
 */
@Module({
  imports: [FileManagerModule],
  controllers: [PastoralController],
  providers: [PastoralService],
})
export class PastoralModule {}
