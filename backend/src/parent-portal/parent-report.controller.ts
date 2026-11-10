import { Controller, Get, Param, ParseUUIDPipe, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { sendPdf, sendPdfBytes } from '@/report-card/report-file';
import { ParentGuard, type ParentRequest } from './parent.guard';
import { ParentReportsService } from './parent-reports.service';
import type { ChildContext } from './parent-portal.service';

const child = (req: ParentRequest): ChildContext => ({
  studentId: req.parent!.studentId!,
  schoolId: req.parent!.schoolId!,
});

/**
 * A linked child's published report cards and transcript. ParentGuard checks
 * the link (active child, school's age limit) for every `:studentId`; the
 * routes need both `parent_portal` and `report_cards` for the child's school,
 * and the school's `showReports` parent setting (403 PARENT_VIEW_HIDDEN).
 * Unpublished terms are never listed or served.
 */
@ApiTags('Parent Portal')
@ApiBearerAuth()
@Controller('parent/children/:studentId')
@UseGuards(AuthGuard, ParentGuard, FeatureGuard)
@RequireFeature('parent_portal', 'report_cards')
export class ParentReportController {
  constructor(private readonly reports: ParentReportsService) {}

  @Get('reports')
  list(@Req() req: ParentRequest) {
    return this.reports.list(child(req));
  }

  @Get('reports/:documentId/file')
  @ApiProduces('application/pdf')
  async file(
    @Req() req: ParentRequest,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() res: FastifyReply,
  ) {
    return sendPdf(res, await this.reports.open(child(req), documentId));
  }

  /** A five-minute signed link to the PDF, for opening it in a new tab. */
  @Get('reports/:documentId/link')
  link(@Req() req: ParentRequest, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.reports.link(child(req), documentId);
  }

  @Get('transcript')
  transcript(@Req() req: ParentRequest) {
    return this.reports.transcript(child(req));
  }

  @Get('transcript.pdf')
  @ApiProduces('application/pdf')
  async transcriptPdf(@Req() req: ParentRequest, @Res() res: FastifyReply) {
    return sendPdfBytes(res, await this.reports.transcriptPdf(child(req)));
  }
}
