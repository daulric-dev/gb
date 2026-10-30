import { Module } from '@nestjs/common';
import { FileManagerController } from './file-manager.controller';
import { FileManagerService } from './file-manager.service';
import { FileShareService } from './file-share.service';
import { FileAccessService } from './file-access.service';
import { FileNotificationService } from './file-notification.service';
import { FolderService } from './folder.service';
import { UploadLimitService } from './upload-limit.service';

@Module({
  controllers: [FileManagerController],
  providers: [
    FileManagerService,
    FileShareService,
    FileAccessService,
    FileNotificationService,
    FolderService,
    UploadLimitService,
  ],
  exports: [FolderService, FileManagerService, UploadLimitService],
})
export class FileManagerModule {}
