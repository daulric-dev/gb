import { Module } from '@nestjs/common';
import { SchoolController } from './school.controller';
import { SchoolService } from './school.service';
import { FileManagerModule } from '@/file-manager/file-manager.module';

@Module({
  // For UploadLimitService (the upload-limit routes).
  imports: [FileManagerModule],
  controllers: [SchoolController],
  providers: [SchoolService],
  exports: [SchoolService],
})
export class SchoolModule {}
