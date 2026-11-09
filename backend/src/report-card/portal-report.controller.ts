import { Controller, Get, Param, ParseUUIDPipe, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { StudentGuard, type StudentRequest } from '@/student-portal/student.guard';
import { StudentReportsService } from './student-reports.service';
import { sendPdf, sendPdfBytes } from './report-file';

/** The student's own published reports and transcript. No route takes a student id. */
@ApiTags('Student Portal')
@ApiBearerAuth()
@Controller('portal/me')
@UseGuards(AuthGuard, StudentGuard, FeatureGuard)
@RequireFeature('report_cards')
export class PortalReportController {
  constructor(private readonly reports: StudentReportsService) {}

  @Get('reports')
  async list(@Req() req: StudentRequest) {
    return this.reports.publishedReportsFor(req.student!.studentId);
  }

  @Get('reports/:documentId/file')
  @ApiProduces('application/pdf')
  async file(
    @Req() req: StudentRequest,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() res: FastifyReply,
  ) {
    return sendPdf(res, await this.reports.openReport(req.student!.studentId, documentId));
  }

  /** A five-minute signed link to the PDF, for opening it in a new tab. */
  @Get('reports/:documentId/link')
  async link(@Req() req: StudentRequest, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.reports.createDownloadLink(req.student!.studentId, documentId);
  }

  @Get('transcript')
  async transcript(@Req() req: StudentRequest) {
    const doc = await this.reports.transcriptFor(req.student!.studentId);
    return { student: doc.student, terms: doc.terms, generatedAt: doc.generatedAt.toISOString() };
  }

  @Get('transcript.pdf')
  @ApiProduces('application/pdf')
  async transcriptPdf(@Req() req: StudentRequest, @Res() res: FastifyReply) {
    return sendPdfBytes(res, await this.reports.transcriptPdfFor(req.student!.studentId));
  }
}
