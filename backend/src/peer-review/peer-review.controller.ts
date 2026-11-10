import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { PeerReviewService } from './peer-review.service';
import {
  AddAllocationDto,
  HideReviewDto,
  PeerReviewSettingsDto,
  ReassignAllocationDto,
} from './peer-review.dto';

/**
 * Staff side of peer review. Access is the caller's role in the activity's
 * course (staff read and hide; teachers change settings and allocations),
 * and `peer_review` is checked against the course's school, by the service.
 */
@ApiTags('Peer review')
@ApiBearerAuth()
@Controller('activities/:activityId/peer-review')
@UseGuards(AuthGuard)
export class PeerReviewController {
  constructor(private readonly peerReview: PeerReviewService) {}

  @Get()
  async overview(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
  ) {
    return this.peerReview.overview(req.user.id as string, activityId);
  }

  @Put()
  async update(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() dto: PeerReviewSettingsDto,
  ) {
    return this.peerReview.updateSettings(req.user.id as string, activityId, dto);
  }

  /** Open the window now, or allocate students who handed in since. */
  @Post('start')
  async start(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
  ) {
    return this.peerReview.start(req.user.id as string, activityId);
  }

  @Post('reviews')
  async add(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() dto: AddAllocationDto,
  ) {
    return this.peerReview.addAllocation(req.user.id as string, activityId, dto);
  }

  @Patch('reviews/:allocationId')
  async reassign(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
    @Body() dto: ReassignAllocationDto,
  ) {
    return this.peerReview.reassign(
      req.user.id as string,
      activityId,
      allocationId,
      dto.reviewerId,
    );
  }

  @Delete('reviews/:allocationId')
  @HttpCode(204)
  async remove(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
  ) {
    await this.peerReview.removeAllocation(req.user.id as string, activityId, allocationId);
  }

  /** Hide an inappropriate review from its author (audited). */
  @Patch('reviews/:allocationId/hidden')
  async hide(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
    @Body() dto: HideReviewDto,
  ) {
    return this.peerReview.setHidden(req.user.id as string, activityId, allocationId, dto);
  }
}
