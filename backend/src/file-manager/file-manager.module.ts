import { Module } from '@nestjs/common';
import { FileManagerController } from './file-manager.controller';
import { FileManagerService } from './file-manager.service';
import { FileShareService } from './file-share.service';
import { FileAccessService } from './file-access.service';
import { FileNotificationService } from './file-notification.service';
import { FolderService } from './folder.service';

@Module({
  controllers: [FileManagerController],
  providers: [
    FileManagerService,
    FileShareService,
    FileAccessService,
    FileNotificationService,
    FolderService,
  ],
  exports: [FolderService],
})
export class FileManagerModule {}
