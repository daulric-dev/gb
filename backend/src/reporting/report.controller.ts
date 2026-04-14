import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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
  generate(@Req() req: { user: { id: string } }, @Body() dto: GenerateReportDto) {
    return this.reportService.generateTermReports(req.user.id, dto);
  }

  @Get()
  findByClassAndTerm(
    @Query('studentGroupId') studentGroupId: string,
    @Query('termId') termId: string,
    @Req() req: { headers?: { authorization?: string } },
  ) {
    return this.reportService.findByClassAndTerm(
      studentGroupId,
      termId,
      this.getToken(req),
    );
  }

  @Get('student')
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
  getPdfHistory(
    @Param('id') id: string,
    @Req() req: { headers?: { authorization?: string } },
  ) {
    return this.reportService.getPdfHistory(id, this.getToken(req));
  }

  @Get(':id/pdf/latest')
  getLatestPdf(
    @Param('id') id: string,
    @Req() req: { headers?: { authorization?: string } },
  ) {
    return this.reportService.getLatestPdf(id, this.getToken(req));
  }

  @Get(':id')
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
  @UseGuards(ClassTeacherGuard)
  savePdf(
    @Param('id') id: string,
    @Req() req: { user: { id: string } },
    @Body() dto: SavePdfDto,
  ) {
    return this.reportService.savePdf(id, req.user.id, dto);
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