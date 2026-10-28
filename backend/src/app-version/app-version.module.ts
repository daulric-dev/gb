import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppVersionController } from './app-version.controller';
import { AppVersionGuard } from './app-version.guard';
import { AppVersionService } from './app-version.service';

/** Mobile app version check and the global 426 for builds below the minimum. */
@Module({
  controllers: [AppVersionController],
  providers: [
    AppVersionService,
    { provide: APP_GUARD, useClass: AppVersionGuard },
  ],
  exports: [AppVersionService],
})
export class AppVersionModule {}
