import { Module } from '@nestjs/common';
import { StudentPortalModule } from '@/student-portal/student-portal.module';
import { DiscussionService } from './discussion.service';
import { DiscussionController } from './discussion.controller';
import { PortalDiscussionController } from './portal-discussion.controller';

/**
 * Course discussion forums. Course access is global; the portal routes
 * reuse StudentGuard from the student portal.
 */
@Module({
  imports: [StudentPortalModule],
  controllers: [DiscussionController, PortalDiscussionController],
  providers: [DiscussionService],
})
export class DiscussionModule {}
