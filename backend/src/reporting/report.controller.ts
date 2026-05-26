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
import { AuthGuard } from '@/auth/auth.guard';
import { ClassTeacherGuard } from '@/class/class-teacher.guard';
import { ReportGuard } from './report.guard';
import { VersioningService } from '@/versioning/versioning.service';
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
  constructor(
    private readonly reportService: ReportService,
    private readonly versioning: VersioningService,
  ) {}

  @Post('generate')
  @UseGuards(ClassTeacherGuard)
  async generate(@Req() req: any, @Body() dto: GenerateReportDto) {
    const raw = await this.reportService.generateTermReports(req.user.id, dto);
    return this.versioning.resolve(req, 'report.generated')(raw);
  }

  @Get()
  @UseGuards(ClassTeacherGuard)
  async findByClassAndTerm(
    @Query('studentGroupId') studentGroupId: string,
    @Query('termId') termId: string,
    @Query('reportType') reportType: string | undefined,
    @Req() req: any,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = await this.reportService.findByClassAndTerm(
      studentGroupId,
      termId,
      req,
      reply,
      reportType,
    );
    return this.versioning.resolve(req, 'report.list')(raw);
  }

  @Get('class-summary')
  @UseGuards(ClassTeacherGuard)
  async getClassSummary(
    @Query('studentGroupId') studentGroupId: string,
    @Query('termId') termId: string,
    @Query('reportType') reportType: string,
    @Req() req: any,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = await this.reportService.getClassSummary(
      studentGroupId,
      termId,
      reportType,
      req,
      reply,
    );
    return this.versioning.resolve(req, 'report.classSummary')(raw);
  }

  @Post('class-summary/upload')
  @UseGuards(ClassTeacherGuard)
  async uploadClassSummaryFile(
    @Req()
    req: any,
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

    const raw = await this.reportService.uploadClassSummaryFile(
      studentGroupId,
      termId,
      reportType,
      fileType,
      req.user.id,
      buffer,
    );
    return this.versioning.resolve(req, 'report.classSummaryUploaded')(raw);
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
  async getClassSummaryFiles(
    @Query('studentGroupId') studentGroupId: string,
    @Query('termId') termId: string,
    @Query('reportType') reportType: string,
    @Req() req: any,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = await this.reportService.getClassSummaryFiles(
      studentGroupId,
      termId,
      reportType,
      req,
      reply,
    );
    return this.versioning.resolve(req, 'report.classSummaryFiles')(raw);
  }

  @Get('student')
  @UseGuards(ClassTeacherGuard)
  async findStudentReport(
    @Query('studentId') studentId: string,
    @Query('termId') termId: string,
    @Query('reportType') reportType: string,
    @Req() req: any,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = await this.reportService.findStudentReport(
      studentId,
      termId,
      reportType,
      req,
      reply,
    );
    return this.versioning.resolve(req, 'report.studentReport')(raw);
  }

  @Get(':id/pdfs')
  @UseGuards(ClassTeacherGuard)
  async getPdfHistory(
    @Param('id') id: string,
    @Req() req: any,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = await this.reportService.getPdfHistory(id, req, reply);
    return this.versioning.resolve(req, 'report.pdfHistory')(raw);
  }

  @Get(':id/pdf/latest')
  @UseGuards(ClassTeacherGuard)
  async getLatestPdf(
    @Param('id') id: string,
    @Req() req: any,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = await this.reportService.getLatestPdf(id, req, reply);
    return this.versioning.resolve(req, 'report.pdfLatest')(raw);
  }

  @Get(':id')
  @UseGuards(ClassTeacherGuard)
  async findOne(
    @Param('id') id: string,
    @Req() req: any,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = await this.reportService.findOne(id, req, reply);
    return this.versioning.resolve(req, 'report.detail')(raw);
  }

  @Patch(':id')
  @UseGuards(ClassTeacherGuard, ReportGuard)
  async updateReport(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateReportDto,
  ) {
    const raw = await this.reportService.updateReport(req.user.id, id, dto);
    return this.versioning.resolve(req, 'report.updated')(raw);
  }

  @Patch(':id/regenerate')
  @UseGuards(ClassTeacherGuard, ReportGuard)
  async regenerate(@Req() req: any, @Param('id') id: string) {
    const raw = await this.reportService.regenerateReport(req.user.id, id);
    return this.versioning.resolve(req, 'report.updated')(raw);
  }

  @Patch(':id/publish')
  @UseGuards(ClassTeacherGuard, ReportGuard)
  async publish(@Req() req: any, @Param('id') id: string) {
    const raw = await this.reportService.publish(req.user.id, id);
    return this.versioning.resolve(req, 'report.updated')(raw);
  }

  @Patch(':id/send-to-ministry')
  @UseGuards(ClassTeacherGuard)
  async sendToMinistry(@Req() req: any, @Param('id') id: string) {
    const raw = await this.reportService.sendToMinistry(req.user.id, id);
    return this.versioning.resolve(req, 'report.updated')(raw);
  }

  @Post(':id/pdf')
  @UseGuards(ClassTeacherGuard, ReportGuard)
  async savePdf(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: SavePdfDto,
  ) {
    const raw = await this.reportService.savePdf(id, req.user.id, dto);
    return this.versioning.resolve(req, 'report.pdfSaved')(raw);
  }

  @Post(':id/pdf/upload')
  @UseGuards(ClassTeacherGuard, ReportGuard)
  async uploadPdf(@Param('id') id: string, @Req() req: any) {
    const file = await req.file();
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const buffer = await file.toBuffer();
    if (!buffer.length) {
      throw new BadRequestException('Empty file');
    }

    const raw = await this.reportService.uploadPdf(id, req.user.id, buffer);
    return this.versioning.resolve(req, 'report.pdfUploaded')(raw);
  }

  @Get(':id/pdf/:pdfId/download')
  @UseGuards(ClassTeacherGuard)
  async downloadPdf(
    @Param('id') id: string,
    @Param('pdfId') pdfId: string,
    @Res() reply: FastifyReply,
  ) {
    const { buffer, filename } = await this.reportService.downloadPdf(
      id,
      pdfId,
    );
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
  constructor(
    private readonly reportService: ReportService,
    private readonly versioning: VersioningService,
  ) {}

  @Patch(':entryId')
  @UseGuards(ReportGuard)
  async updateEntry(
    @Req() req: any,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('entryId') entryId: string,
    @Body() dto: UpdateReportEntryDto,
  ) {
    const raw = await this.reportService.updateReportEntry(
      entryId,
      dto,
      req,
      reply,
    );
    return this.versioning.resolve(req, 'reportEntry.updated')(raw);
  }
}
