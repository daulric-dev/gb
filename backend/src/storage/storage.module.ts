import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { ByteBudget, uploadVerifyBudgetBytes } from './byte-budget';

@Global()
@Module({
  providers: [
    StorageService,
    // One budget for the whole process: every upload check that buffers a
    // file draws from it (UPLOAD_VERIFY_MEMORY_MB).
    { provide: ByteBudget, useFactory: () => new ByteBudget(uploadVerifyBudgetBytes()) },
  ],
  exports: [StorageService, ByteBudget],
})
export class StorageModule {}
