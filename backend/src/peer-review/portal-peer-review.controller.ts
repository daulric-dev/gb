import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { StudentGuard, type StudentRequest } from '@/student-portal/student.guard';
import { contentDisposition } from '@/grading/content-disposition';
import { PeerReviewService } from './peer-review.service';
import { SaveReviewDto } from './peer-review.dto';

/** Same inline types as staff marking views; anything else downloads. */
const INLINE_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
]);

/**
 * A student's peer reviews. The reviewer is always the student StudentGuard
 * resolved; an allocation that is not theirs is a 404.
 */
@ApiTags('Student Portal')
@ApiBearerAuth()
@Controller('portal/me')
@UseGuards(AuthGuard, StudentGuard, FeatureGuard)
@RequireFeature('peer_review')
export class PortalPeerReviewController {
  constructor(private readonly peerReview: PeerReviewService) {}

  /** Reviews to do in open windows, across courses. */
  @Get('peer-reviews')
  async list(@Req() req: StudentRequest) {
    return this.peerReview.listForStudent(req.student!.studentId);
  }

  /** Peer review on one activity: reviews to do, and reviews received. */
  @Get('activities/:activityId/peer-review')
  async forActivity(
    @Req() req: StudentRequest,
    @Param('activityId', ParseUUIDPipe) activityId: string,
  ) {
    return this.peerReview.activityForStudent(req.student!.studentId, activityId);
  }

  @Get('peer-reviews/:allocationId')
  async get(
    @Req() req: StudentRequest,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
  ) {
    return this.peerReview.reviewForStudent(req.student!.studentId, allocationId);
  }

  /** Save the review; `submit` hands it in (still editable until it closes). */
  @Put('peer-reviews/:allocationId')
  async save(
    @Req() req: StudentRequest,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
    @Body() dto: SaveReviewDto,
  ) {
    return this.peerReview.saveReview(req.student!.studentId, allocationId, dto);
  }

  /** A file of the classmate's submission, sandboxed like staff views. */
  @Get('peer-reviews/:allocationId/files/:fileId')
  @ApiProduces('application/octet-stream')
  async file(
    @Req() req: StudentRequest,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res() res: FastifyReply,
  ) {
    const { body, size, contentType, filename } = await this.peerReview.readReviewFile(
      req.student!.studentId,
      allocationId,
      fileId,
    );
    if (size !== null && size !== undefined) res.header('Content-Length', size);
    return res
      .header(
        'Content-Type',
        contentType && INLINE_TYPES.has(contentType) ? contentType : 'application/octet-stream',
      )
      .header('Content-Disposition', contentDisposition('inline', filename))
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', 'sandbox')
      .send(body);
  }
}
