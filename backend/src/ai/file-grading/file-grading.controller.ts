import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@/auth/auth.guard';
import { AiFileGradingService } from './file-grading.service';
import { FileGradingDraftDto, StartBatchDto } from './file-grading.dto';

type Req = { user: { id: string } };
const uuid = new ParseUUIDPipe();
/** One draft is one paid AI request: the same window as the other generating routes. */
const DRAFT_THROTTLE = { route: { limit: 10, ttl: 60 * 1000 } };
/** Starting a batch queues many requests: a few a minute. */
const BATCH_THROTTLE = { route: { limit: 3, ttl: 60 * 1000 } };
/** Reading progress is polled while a batch runs. */
const READ_THROTTLE = { route: { limit: 120, ttl: 60 * 1000 } };

/**
 * AI grading drafts for handed-in work (src/ai/file-grading). Staff of the
 * activity's course (who may mark), `ai_assistance` on, an assignment, and
 * the school's allow-student-work and allow-uploaded-files switches; all
 * checked by the service. Drafts only: no route here writes a mark.
 */
@ApiTags('AI assistance')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('activities/:activityId/ai/grading')
export class AiFileGradingController {
  constructor(private readonly grading: AiFileGradingService) {}

  @Throttle(READ_THROTTLE)
  @Get()
  overview(@Req() req: Req, @Param('activityId', uuid) activityId: string) {
    return this.grading.overview(req.user.id, activityId);
  }

  @Throttle(DRAFT_THROTTLE)
  @Post('drafts')
  @HttpCode(200)
  draft(@Req() req: Req, @Param('activityId', uuid) activityId: string, @Body() dto: FileGradingDraftDto) {
    return this.grading.draftOne(req.user.id, activityId, dto.studentId);
  }

  @Throttle(READ_THROTTLE)
  @Get('drafts/:studentId')
  get(@Req() req: Req, @Param('activityId', uuid) activityId: string, @Param('studentId', uuid) studentId: string) {
    return this.grading.get(req.user.id, activityId, studentId);
  }

  @Delete('drafts/:studentId')
  @HttpCode(204)
  async discard(@Req() req: Req, @Param('activityId', uuid) activityId: string, @Param('studentId', uuid) studentId: string) {
    await this.grading.discard(req.user.id, activityId, studentId);
  }

  @Throttle(DRAFT_THROTTLE)
  @Get('batch/preview')
  preview(@Req() req: Req, @Param('activityId', uuid) activityId: string) {
    return this.grading.batchPreview(req.user.id, activityId);
  }

  @Throttle(BATCH_THROTTLE)
  @Post('batch')
  @HttpCode(200)
  start(@Req() req: Req, @Param('activityId', uuid) activityId: string, @Body() dto: StartBatchDto) {
    return this.grading.startBatch(req.user.id, activityId, dto.expectedSubmissions);
  }

  @Throttle(READ_THROTTLE)
  @Get('batch/:batchId')
  batch(@Req() req: Req, @Param('activityId', uuid) activityId: string, @Param('batchId', uuid) batchId: string) {
    return this.grading.batchStatus(req.user.id, activityId, batchId);
  }

  @Post('batch/:batchId/cancel')
  @HttpCode(200)
  cancel(@Req() req: Req, @Param('activityId', uuid) activityId: string, @Param('batchId', uuid) batchId: string) {
    return this.grading.cancelBatch(req.user.id, activityId, batchId);
  }
}
