import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { AuthGuard } from '@/auth/auth.guard';
import { ClassTeacherGuard } from '@/class/class-teacher.guard';
import { ReportGuard } from './report.guard';
import { ReportService } from './report.service';
import { GenerateReportDto } from './dto/generate-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { UpdateReportEntryDto } from './dto/update-report-entry.dto';
import { SavePdfDto } from './dto/save-pdf.dto';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(AuthGuard)
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  private getToken(req: { headers?: { authorization?: string } }): string {
    return req.headers?.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  }

  @Post('generate')
  @UseGuards(ClassTeacherGuard)
  generate(
    @Req() req: { user: { id: string } },
    @Body() dto: GenerateReportDto,
  ) {
    return this.reportService.generateTermReports(req.user.id, dto);
  }

  @Get()
  @UseGuards(ClassTeacherGuard)
  findByClassAndTerm(
    @Query('studentGroupId') studentGroupId: string,
    @Query('termId') termId: string,
    @Query('reportType') reportType: string | undefined,
    @Req() req: { headers?: { authorization?: string } },
  ) {
    return this.reportService.findByClassAndTerm(
      studentGroupId,
      termId,
      this.getToken(req),
      reportType,
    );
  }

  @Get('class-summary')
  @UseGuards(ClassTeacherGuard)
  getClassSummary(
    @Query('studentGroupId') studentGroupId: string,
    @Query('termId') termId: string,
    @Query('reportType') reportType: string,
    @Req() req: { headers?: { authorization?: string } },
  ) {
    return this.reportService.getClassSummary(
      studentGroupId,
      termId,
      reportType,
      this.getToken(req),
    );
  }

  @Post('class-summary/upload')
  @UseGuards(ClassTeacherGuard)
  async uploadClassSummaryFile(
    @Req()
    req: {
      user: { id: string };
      file: () => Promise<MultipartFile | undefined>;
    },
  ) {
    const file = await req.file();
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const buffer = await file.toBuffer();
    if (!buffer.length) {
      throw new BadRequestException('Empty file');
    }

    const fields = file.fields as Record<
      string,
      { value?: string } | undefined
    >;
    const studentGroupId = fields?.studentGroupId?.value;
    const termId = fields?.termId?.value;
    const reportType = fields?.reportType?.value;
    const fileType = fields?.fileType?.value;

    if (!studentGroupId || !termId || !reportType || !fileType) {
      throw new BadRequestException(
        'Missing required fields: studentGroupId, termId, reportType, fileType',
      );
    }

    return this.reportService.uploadClassSummaryFile(
      studentGroupId,
      termId,
      reportType,
      fileType,
      req.user.id,
      buffer,
    );
  }

  @Get('class-summary/download')
  @UseGuards(ClassTeacherGuard)
  async downloadClassSummaryFile(
    @Query('studentGroupId') studentGroupId: string,
    @Query('termId') termId: string,
    @Query('reportType') reportType: string,
    @Query('fileType') fileType: string,
    @Res() reply: FastifyReply,
  ) {
    const { buffer, filename, contentType } =
      await this.reportService.downloadClassSummaryFile(
        studentGroupId,
        termId,
        reportType,
        fileType,
      );
    reply
      .header('Content-Type', contentType)
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Length', buffer.length)
      .send(buffer);
  }

  @Get('class-summary/files')
  @UseGuards(ClassTeacherGuard)
  getClassSummaryFiles(
    @Query('studentGroupId') studentGroupId: string,
    @Query('termId') termId: string,
    @Query('reportType') reportType: string,
    @Req() req: { headers?: { authorization?: string } },
  ) {
    return this.reportService.getClassSummaryFiles(
      studentGroupId,
      termId,
      reportType,
      this.getToken(req),
    );
  }

  @Get('student')
  @UseGuards(ClassTeacherGuard)
  findStudentReport(
    @Query('studentId') studentId: string,
    @Query('termId') termId: string,
    @Query('reportType') reportType: string,
    @Req() req: { headers?: { authorization?: string } },
  ) {
    return this.reportService.findStudentReport(
      studentId,
      termId,
      reportType,
      this.getToken(req),
    );
  }

  @Get(':id/pdfs')
  @UseGuards(ClassTeacherGuard)
  getPdfHistory(
    @Param('id') id: string,
    @Req() req: { headers?: { authorization?: string } },
  ) {
    return this.reportService.getPdfHistory(id, this.getToken(req));
  }

  @Get(':id/pdf/latest')
  @UseGuards(ClassTeacherGuard)
  getLatestPdf(
    @Param('id') id: string,
    @Req() req: { headers?: { authorization?: string } },
  ) {
    return this.reportService.getLatestPdf(id, this.getToken(req));
  }

  @Get(':id')
  @UseGuards(ClassTeacherGuard)
  findOne(
    @Param('id') id: string,
    @Req() req: { headers?: { authorization?: string } },
  ) {
    return this.reportService.findOne(id, this.getToken(req));
  }

  @Patch(':id')
  @UseGuards(ClassTeacherGuard, ReportGuard)
  updateReport(@Param('id') id: string, @Body() dto: UpdateReportDto) {
    return this.reportService.updateReport(id, dto);
  }

  @Patch(':id/regenerate')
  @UseGuards(ClassTeacherGuard, ReportGuard)
  regenerate(@Param('id') id: string) {
    return this.reportService.regenerateReport(id);
  }

  @Patch(':id/publish')
  @UseGuards(ClassTeacherGuard, ReportGuard)
  publish(@Param('id') id: string) {
    return this.reportService.publish(id);
  }

  @Patch(':id/send-to-ministry')
  @UseGuards(ClassTeacherGuard)
  sendToMinistry(@Param('id') id: string) {
    return this.reportService.sendToMinistry(id);
  }

  @Post(':id/pdf')
  @UseGuards(ClassTeacherGuard, ReportGuard)
  savePdf(
    @Param('id') id: string,
    @Req() req: { user: { id: string } },
    @Body() dto: SavePdfDto,
  ) {
    return this.reportService.savePdf(id, req.user.id, dto);
  }

  @Post(':id/pdf/upload')
  @UseGuards(ClassTeacherGuard, ReportGuard)
  async uploadPdf(
    @Param('id') id: string,
    @Req()
    req: {
      user: { id: string };
      file: () => Promise<MultipartFile | undefined>;
    },
  ) {
    const file = await req.file();
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const buffer = await file.toBuffer();
    if (!buffer.length) {
      throw new BadRequestException('Empty file');
    }

    const objectPath =
      (file.fields?.objectPath as { value?: string } | undefined)?.value ??
      `${id}.pdf`;

    return this.reportService.uploadPdf(id, req.user.id, buffer, objectPath);
  }

  @Get(':id/pdf/:pdfId/download')
  @UseGuards(ClassTeacherGuard)
  async downloadPdf(@Param('pdfId') pdfId: string, @Res() reply: FastifyReply) {
    const { buffer, filename } = await this.reportService.downloadPdf(pdfId);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Length', buffer.length)
      .send(buffer);
  }
}

@ApiTags('Report entries')
@ApiBearerAuth()
@Controller('report-entries')
@UseGuards(AuthGuard)
export class ReportEntriesController {
  constructor(private readonly reportService: ReportService) {}

  private getToken(req: { headers?: { authorization?: string } }): string {
    return req.headers?.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  }

  @Patch(':entryId')
  @UseGuards(ReportGuard)
  updateEntry(
    @Param('entryId') entryId: string,
    @Body() dto: UpdateReportEntryDto,
    @Req() req: { headers?: { authorization?: string } },
  ) {
    return this.reportService.updateReportEntry(
      entryId,
      dto,
      this.getToken(req),
    );
  }
}
