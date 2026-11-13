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
import { RequireStepUp } from '@/auth/step-up.guard';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { contentDisposition } from '@/grading/content-disposition';
import { AuditLogService } from '@/audit-log/audit-log.service';
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
  constructor(
    private readonly releases: ReportReleaseService,
    private readonly audit: AuditLogService,
  ) {}

  @RequirePermission('report-card', 'read')
  @Get('terms')
  async terms(@Req() req: any) {
    const userId = req.user.id as string;
    const result = await this.releases.terms(userId);
    await this.audit.recordRead(userId, { entity: 'report_release_terms' });
    return result;
  }

  @RequirePermission('report-card', 'read')
  @Get('terms/:termId')
  async overview(@Req() req: any, @Param('termId', ParseUUIDPipe) termId: string) {
    const userId = req.user.id as string;
    const result = await this.releases.overview(userId, termId);
    await this.audit.recordRead(userId, { entity: 'report_release_overview', entityId: termId });
    return result;
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
    const userId = req.user.id as string;
    const result = await this.releases.students(userId, termId);
    await this.audit.recordRead(userId, { entity: 'report_release_students', entityId: termId });
    return result;
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
    const userId = req.user.id as string;
    const pdf = await this.releases.preview(userId, termId, studentId);
    await this.audit.recordRead(userId, {
      entity: 'report_card_preview',
      entityId: studentId,
      details: { termId },
    });
    return sendPdfBytes(res, pdf, 'inline');
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
    const userId = req.user.id as string;
    const file = await this.releases.file(userId, termId, studentId);
    await this.audit.recordRead(userId, {
      entity: 'report_card_file',
      entityId: studentId,
      details: { termId },
    });
    return sendPdf(res, file);
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

  /** Every generated PDF of the term, or of one course (a class), as a zip. Needs step-up; audited as an export. */
  @RequirePermission('report-card', 'read')
  @RequireStepUp()
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
