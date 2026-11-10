import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { ReportCommentService } from './report-comment.service';
import { SaveReportCommentsDto } from './dto/report-card.dto';

/**
 * A course's report comments table. Access is the caller's course role
 * (CourseAccessService): staff read, a teacher of the course writes.
 */
@ApiTags('Report Cards')
@ApiBearerAuth()
@Controller('courses/:courseId/report-comments')
@UseGuards(AuthGuard, FeatureGuard)
@RequireFeature('report_cards')
export class ReportCommentController {
  constructor(private readonly comments: ReportCommentService) {}

  @Get()
  async list(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Query('termId', new ParseUUIDPipe({ optional: true })) termId?: string,
  ) {
    return this.comments.list(req.user.id as string, courseId, termId);
  }

  @Put()
  async save(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: SaveReportCommentsDto,
  ) {
    return this.comments.save(req.user.id as string, courseId, dto);
  }
}
