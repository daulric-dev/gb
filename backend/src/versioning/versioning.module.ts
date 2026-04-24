import { Global, Module } from '@nestjs/common';
import { VersioningService } from './versioning.service';
import { TransformerRegistry } from './transformer-registry';

@Global()
@Module({
  providers: [VersioningService, TransformerRegistry],
  exports: [VersioningService],
})
export class VersioningModule {}
