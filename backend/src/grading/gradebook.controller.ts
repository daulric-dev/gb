import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { AuditLogService } from '@/audit-log/audit-log.service';
import { RequireStepUp } from '@/auth/step-up.guard';
import { GradebookService } from './gradebook.service';
import { GradebookImportService } from './gradebook-import.service';
import { ImportGradebookDto } from './dto/gradebook-import.dto';

/** The course gradebook, for every staff role in the course. */
@ApiTags('Grading')
@ApiBearerAuth()
@Controller('courses/:courseId/gradebook')
@UseGuards(AuthGuard)
export class GradebookController {
  constructor(
    private readonly gradebook: GradebookService,
    private readonly importer: GradebookImportService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  async get(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.gradebook.gradebook(req.user.id as string, courseId);
  }

  /** Bulk export of personal data: step-up, and audited with its row count. */
  @Get('export')
  @ApiProduces('text/csv')
  @RequireStepUp()
  async export(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Res() res: FastifyReply,
  ) {
    const { csv, filename } = await this.gradebook.exportCsv(
      req.user.id as string,
      courseId,
    );
    await this.audit.recordExport(req.user.id as string, {
      courseId,
      entity: 'gradebook',
      scope: 'course',
      csv,
    });

    return res
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Cache-Control', 'private, no-store')
      .send(csv);
  }

  /** What a CSV import would change; nothing is written. */
  @Post('import/preview')
  @HttpCode(200)
  async previewImport(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: ImportGradebookDto,
  ) {
    return this.importer.preview(req.user.id as string, courseId, dto.csv);
  }

  /** Re-plans the same CSV and writes every change in one transaction. */
  @Post('import')
  @HttpCode(200)
  async applyImport(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: ImportGradebookDto,
  ) {
    return this.importer.apply(req.user.id as string, courseId, dto.csv);
  }
}
