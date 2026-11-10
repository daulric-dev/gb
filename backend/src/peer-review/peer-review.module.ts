import { Module } from '@nestjs/common';
import { FileManagerModule } from '@/file-manager/file-manager.module';
import { PeerReviewService } from './peer-review.service';
import { PeerReviewScheduler } from './peer-review.scheduler';
import { PeerReviewController } from './peer-review.controller';
import { PortalPeerReviewController } from './portal-peer-review.controller';
import { StudentGuard } from '@/student-portal/student.guard';

/**
 * Peer review on assignments (feature `peer_review`). Course access,
 * features, notifications, audit and hand-in events come from global
 * modules; files are read through FileManagerService.
 */
@Module({
  imports: [FileManagerModule],
  providers: [PeerReviewService, PeerReviewScheduler, StudentGuard],
  controllers: [PeerReviewController, PortalPeerReviewController],
})
export class PeerReviewModule {}
