import { Global, Module } from '@nestjs/common';
import { ClamavScanner } from './clamav.scanner';

@Global()
@Module({
  providers: [ClamavScanner],
  exports: [ClamavScanner],
})
export class ScanModule {}
