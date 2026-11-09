import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { StudentReportsService } from './student-reports.service';
import { sendPdf } from './report-file';

/**
 * Signed report links (report-link.ts). No session: the token is the
 * credential, names one document, and lasts five minutes. The feature,
 * publish state and storage key are checked again on every use.
 */
@ApiTags('Report Cards')
@Controller('report-cards/files')
export class ReportLinkController {
  constructor(private readonly reports: StudentReportsService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token')
  @ApiProduces('application/pdf')
  async open(@Param('token') token: string, @Res() res: FastifyReply) {
    return sendPdf(res, await this.reports.openSignedLink(token));
  }
}
