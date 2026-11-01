import { Module } from '@nestjs/common';
import { SchoolController } from './school.controller';
import { SchoolService } from './school.service';
import { FileManagerModule } from '@/file-manager/file-manager.module';
import { ImagesModule } from '@/images/images.module';
import { SchoolLogoService } from './school-logo.service';

@Module({
  // For UploadLimitService (the upload-limit routes) and ImagesService (logo).
  imports: [FileManagerModule, ImagesModule],
  controllers: [SchoolController],
  providers: [SchoolService, SchoolLogoService],
  exports: [SchoolService],
})
export class SchoolModule {}
