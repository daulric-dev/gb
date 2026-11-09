import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { contentDisposition } from '@/grading/content-disposition';
import { ReportReleaseService } from './report-release.service';
import { RegenerateReportsDto, SaveHeadCommentsDto, UpdateReportReleaseDto } from './dto/report-card.dto';
import { sendPdf, sendPdfBytes } from './report-file';

/**
 * The school's report card release dashboard, in the caller's active
 * school: `report-card:read` to look, preview and download;
 * `report-card:update` for head comments, the deadline and publishing.
 */
@ApiTags('Report Cards')
@ApiBearerAuth()
@Controller('report-cards')
@UseGuards(AuthGuard, PermissionGuard, FeatureGuard)
@RequireFeature('report_cards')
export class ReportReleaseController {
  constructor(private readonly releases: ReportReleaseService) {}

  @RequirePermission('report-card', 'read')
  @Get('terms')
  async terms(@Req() req: any) {
    return this.releases.terms(req.user.id as string);
  }

  @RequirePermission('report-card', 'read')
  @Get('terms/:termId')
  async overview(@Req() req: any, @Param('termId', ParseUUIDPipe) termId: string) {
    return this.releases.overview(req.user.id as string, termId);
  }

  @RequirePermission('report-card', 'update')
  @Patch('terms/:termId')
  async update(
    @Req() req: any,
    @Param('termId', ParseUUIDPipe) termId: string,
    @Body() dto: UpdateReportReleaseDto,
  ) {
    return this.releases.update(req.user.id as string, termId, dto);
  }

  @RequirePermission('report-card', 'read')
  @Get('terms/:termId/students')
  async students(@Req() req: any, @Param('termId', ParseUUIDPipe) termId: string) {
    return this.releases.students(req.user.id as string, termId);
  }

  @RequirePermission('report-card', 'update')
  @Put('terms/:termId/head-comments')
  async headComments(
    @Req() req: any,
    @Param('termId', ParseUUIDPipe) termId: string,
    @Body() dto: SaveHeadCommentsDto,
  ) {
    return this.releases.saveHeadComments(req.user.id as string, termId, dto);
  }

  @RequirePermission('report-card', 'read')
  @Get('terms/:termId/students/:studentId/preview')
  @ApiProduces('application/pdf')
  async preview(
    @Req() req: any,
    @Param('termId', ParseUUIDPipe) termId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Res() res: FastifyReply,
  ) {
    return sendPdfBytes(res, await this.releases.preview(req.user.id as string, termId, studentId), 'inline');
  }

  @RequirePermission('report-card', 'read')
  @Get('terms/:termId/students/:studentId/file')
  @ApiProduces('application/pdf')
  async file(
    @Req() req: any,
    @Param('termId', ParseUUIDPipe) termId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Res() res: FastifyReply,
  ) {
    return sendPdf(res, await this.releases.file(req.user.id as string, termId, studentId));
  }

  @RequirePermission('report-card', 'update')
  @Post('terms/:termId/publish')
  async publish(@Req() req: any, @Param('termId', ParseUUIDPipe) termId: string) {
    return this.releases.publish(req.user.id as string, termId);
  }

  @RequirePermission('report-card', 'update')
  @Post('terms/:termId/unpublish')
  async unpublish(@Req() req: any, @Param('termId', ParseUUIDPipe) termId: string) {
    return this.releases.unpublish(req.user.id as string, termId);
  }

  @RequirePermission('report-card', 'update')
  @Post('terms/:termId/regenerate')
  async regenerate(
    @Req() req: any,
    @Param('termId', ParseUUIDPipe) termId: string,
    @Body() dto: RegenerateReportsDto,
  ) {
    return this.releases.regenerate(req.user.id as string, termId, !!dto.failedOnly);
  }

  /** Every generated PDF of the term, or of one course (a class), as a zip. */
  @RequirePermission('report-card', 'read')
  @Get('terms/:termId/reports.zip')
  @ApiProduces('application/zip')
  async zip(
    @Req() req: any,
    @Param('termId', ParseUUIDPipe) termId: string,
    @Query('courseId', new ParseUUIDPipe({ optional: true })) courseId: string | undefined,
    @Res() res: FastifyReply,
  ) {
    const { archive, filename } = await this.releases.zip(req.user.id as string, termId, courseId);
    return res
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', contentDisposition('attachment', filename))
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(archive);
  }

  @RequirePermission('report-card', 'read')
  @Get('students/:studentId/transcript')
  async transcript(@Req() req: any, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.releases.transcript(req.user.id as string, studentId);
  }

  @RequirePermission('report-card', 'read')
  @Get('students/:studentId/transcript.pdf')
  @ApiProduces('application/pdf')
  async transcriptPdf(
    @Req() req: any,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Res() res: FastifyReply,
  ) {
    return sendPdfBytes(res, await this.releases.transcriptPdf(req.user.id as string, studentId));
  }
}
