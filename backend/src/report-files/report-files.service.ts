import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CalculationService } from '@/calculation/calculation.service';
import { ReportService } from '@/reporting/report.service';
import {
  buildReportPdfBuffer,
  buildClassSummaryPdfBuffer,
} from './generation/pdf.generator';
import {
  buildYearReportPdfBuffer,
  yearReportPdfFilename,
  buildYearClassSummaryPdfBuffer,
} from './generation/year-pdf.generator';
import { uniqueName } from './generation/filename.util';
import {
  buildClassSummaryCsvBuffer,
  buildClassSummaryXlsxBuffer,
} from './generation/export.generator';
import {
  buildYearClassSummaryCsvBuffer,
  buildYearClassSummaryXlsxBuffer,
} from './generation/year-export.generator';
import { termResultsToClassSummary } from './generation/class-summary.transform';
import { buildStudentReportPdfBuffer } from './generation/student-report.generator';
import { buildEndOfYearExamPdfBuffer } from './generation/exam-report.generator';
import { CONTENT_TYPES, type GeneratedFile } from './generation/types';

type SummaryFormat = 'pdf' | 'csv' | 'xlsx';

interface TermContext {
  name: string | null;
  courseworkWeight: number | null;
  examWeight: number | null;
  academicYearId: string | null;
}

interface AcademicYearContext {
  name: string | null;
  gradingModel: string;
  yearCwWeight: number | null;
  yearExWeight: number | null;
}

@Injectable()
export class ReportFilesService {
  private readonly logger = new Logger(ReportFilesService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly calculationService: CalculationService,
    private readonly reportService: ReportService,
  ) {}

  // --- context helpers -----------------------------------------------------

  private async getClassName(studentGroupId: string): Promise<string> {
    const { data } = await this.supabaseService
      .getServiceClient()
      .from('student_group')
      .select('name')
      .eq('id', studentGroupId)
      .maybeSingle();
    return data?.name ?? 'Class';
  }

  private async getTermContext(termId: string): Promise<TermContext> {
    const { data } = await this.supabaseService
      .getServiceClient()
      .from('term')
      .select('name, coursework_weight, exam_weight, academic_year_id')
      .eq('id', termId)
      .maybeSingle();
    return {
      name: data?.name ?? null,
      courseworkWeight: data?.coursework_weight ?? null,
      examWeight: data?.exam_weight ?? null,
      academicYearId: data?.academic_year_id ?? null,
    };
  }

  private async getAcademicYearContext(
    academicYearId: string,
  ): Promise<AcademicYearContext> {
    const { data } = await this.supabaseService
      .getServiceClient()
      .from('academic_year')
      .select('name, grading_model, year_coursework_weight, year_exam_weight')
      .eq('id', academicYearId)
      .maybeSingle();
    return {
      name: data?.name ?? null,
      gradingModel: data?.grading_model ?? 'weighted_continuous',
      yearCwWeight: data?.year_coursework_weight ?? null,
      yearExWeight: data?.year_exam_weight ?? null,
    };
  }

  private safe(name: string): string {
    return name.replace(/\s+/g, '_');
  }

  // --- single-student PDFs -------------------------------------------------

  async getStudentTermPdf(
    studentId: string,
    termId: string,
    studentGroupId: string,
  ): Promise<GeneratedFile> {
    const result = await this.calculationService.calculateStudentTermResult(
      studentId,
      termId,
      studentGroupId,
    );
    const term = await this.getTermContext(termId);
    const ay = term.academicYearId
      ? await this.getAcademicYearContext(term.academicYearId)
      : null;

    const buffer = buildReportPdfBuffer(result, {
      termName: term.name ?? undefined,
      gradingModel: ay?.gradingModel,
    });
    return {
      buffer,
      filename: `${this.safe(`${result.firstName}_${result.lastName}`)}_report.pdf`,
      contentType: CONTENT_TYPES.pdf,
    };
  }

  async getStudentYearPdf(
    studentId: string,
    academicYearId: string,
    studentGroupId: string,
  ): Promise<GeneratedFile> {
    const result = await this.calculationService.calculateStudentYearResult(
      studentId,
      academicYearId,
      studentGroupId,
    );
    const className = await this.getClassName(studentGroupId);

    // Mirrors the current single-student export, which passes only className.
    const buffer = buildYearReportPdfBuffer(result, { className });
    return {
      buffer,
      filename: yearReportPdfFilename(result),
      contentType: CONTENT_TYPES.pdf,
    };
  }

  /** Designed student "Report Card" (react-pdf). */
  async getStudentReportCard(
    studentId: string,
    termId: string,
    studentGroupId: string,
  ): Promise<GeneratedFile> {
    const result = await this.calculationService.calculateStudentTermResult(
      studentId,
      termId,
      studentGroupId,
    );
    const term = await this.getTermContext(termId);
    const className = await this.getClassName(studentGroupId);
    const ay = term.academicYearId
      ? await this.getAcademicYearContext(term.academicYearId)
      : null;

    const buffer = await buildStudentReportPdfBuffer(result, {
      termName: term.name ?? undefined,
      className,
      gradingModel: ay?.gradingModel,
    });
    return {
      buffer,
      filename: `${this.safe(`${result.firstName}_${result.lastName}`)}_report_card.pdf`,
      contentType: CONTENT_TYPES.pdf,
    };
  }

  /** End-of-year / term exam report (react-pdf). */
  async getExamReport(
    studentGroupId: string,
    termId: string,
    reportType: string,
  ): Promise<GeneratedFile> {
    const className = await this.getClassName(studentGroupId);
    const term = await this.getTermContext(termId);
    const ay = term.academicYearId
      ? await this.getAcademicYearContext(term.academicYearId)
      : null;

    const termResults = await this.calculationService.calculateClassTermResults(
      termId,
      studentGroupId,
    );
    const summary = termResultsToClassSummary(termResults, {
      courseworkWeight: term.courseworkWeight ?? 60,
      examWeight: term.examWeight ?? 40,
      gradingModel: ay?.gradingModel,
    });

    const isYearEnd = reportType === 'year_end';
    const yearResults =
      isYearEnd && term.academicYearId
        ? await this.calculationService.calculateClassYearResults(
            term.academicYearId,
            studentGroupId,
          )
        : undefined;

    const buffer = await buildEndOfYearExamPdfBuffer(summary, {
      className,
      termName: term.name ?? undefined,
      academicYear: ay?.name ?? undefined,
      scoreField: isYearEnd ? 'yearGrade' : 'termComposite',
      yearResults,
      gradingModel: ay?.gradingModel,
    });
    return {
      buffer,
      filename: `${this.safe(className)}_${isYearEnd ? 'year_exam_report' : 'exam_report'}.pdf`,
      contentType: CONTENT_TYPES.pdf,
    };
  }

  // --- class summary (pdf/csv/xlsx, term + year) ---------------------------

  async getClassSummaryFile(
    studentGroupId: string,
    termId: string,
    reportType: string,
    format: SummaryFormat,
  ): Promise<GeneratedFile> {
    const className = await this.getClassName(studentGroupId);
    const term = await this.getTermContext(termId);
    const ay = term.academicYearId
      ? await this.getAcademicYearContext(term.academicYearId)
      : null;

    if (reportType === 'year_end') {
      if (!term.academicYearId) {
        throw new BadRequestException(
          'Term is not linked to an academic year; cannot build year-end summary',
        );
      }
      const yearResults =
        await this.calculationService.calculateClassYearResults(
          term.academicYearId,
          studentGroupId,
        );
      const yearOpts = {
        academicYearName: ay?.name ?? undefined,
        yearCwWeight: ay?.yearCwWeight ?? undefined,
        yearExWeight: ay?.yearExWeight ?? undefined,
      };
      const buffer =
        format === 'pdf'
          ? buildYearClassSummaryPdfBuffer(yearResults, className, yearOpts)
          : format === 'csv'
            ? buildYearClassSummaryCsvBuffer(yearResults, className, yearOpts)
            : buildYearClassSummaryXlsxBuffer(yearResults, className, yearOpts);
      return {
        buffer,
        filename: `${this.safe(className)}_year_summary.${format}`,
        contentType: CONTENT_TYPES[format],
      };
    }

    const termResults = await this.calculationService.calculateClassTermResults(
      termId,
      studentGroupId,
    );
    const summary = termResultsToClassSummary(termResults, {
      courseworkWeight: term.courseworkWeight ?? 60,
      examWeight: term.examWeight ?? 40,
      gradingModel: ay?.gradingModel,
    });
    const buffer =
      format === 'pdf'
        ? buildClassSummaryPdfBuffer(
            summary,
            className,
            reportType,
            term.name ?? undefined,
            ay?.gradingModel,
          )
        : format === 'csv'
          ? buildClassSummaryCsvBuffer(
              summary,
              className,
              reportType,
              term.name ?? undefined,
              ay?.gradingModel,
            )
          : buildClassSummaryXlsxBuffer(
              summary,
              className,
              reportType,
              term.name ?? undefined,
              ay?.gradingModel,
            );
    return {
      buffer,
      filename: `${this.safe(className)}_summary.${format}`,
      contentType: CONTENT_TYPES[format],
    };
  }

  /**
   * Plan a bulk zip of every student's report card for a class+term (or year).
   * Fetches the (cached) class results and context up front so auth/404 errors
   * surface before the response is hijacked, and returns lazy `render()`
   * closures so the controller can generate one PDF at a time while streaming —
   * keeping memory flat regardless of class size.
   */
  async prepareClassZip(
    studentGroupId: string,
    termId: string,
    reportType: string,
  ): Promise<{
    zipFilename: string;
    entries: { filename: string; render: () => Buffer }[];
  }> {
    const className = await this.getClassName(studentGroupId);
    const term = await this.getTermContext(termId);
    const ay = term.academicYearId
      ? await this.getAcademicYearContext(term.academicYearId)
      : null;
    const used = new Set<string>();

    if (reportType === 'year_end') {
      if (!term.academicYearId) {
        throw new BadRequestException(
          'Term is not linked to an academic year; cannot build year-end reports',
        );
      }
      const results = await this.calculationService.calculateClassYearResults(
        term.academicYearId,
        studentGroupId,
      );
      const entries = results.map((yr) => ({
        filename: uniqueName(yearReportPdfFilename(yr), used),
        render: () => buildYearReportPdfBuffer(yr, { className }),
      }));
      return {
        zipFilename: `${this.safe(className)}_year_reports.zip`,
        entries,
      };
    }

    const results = await this.calculationService.calculateClassTermResults(
      termId,
      studentGroupId,
    );
    const entries = results.map((tr) => {
      const safe = this.safe(`${tr.firstName}_${tr.lastName}`);
      return {
        filename: uniqueName(`${safe}_report.pdf`, used),
        render: () =>
          buildReportPdfBuffer(tr, {
            termName: term.name ?? undefined,
            gradingModel: ay?.gradingModel,
          }),
      };
    });
    return { zipFilename: `${this.safe(className)}_reports.zip`, entries };
  }

  /**
   * Generate the class-summary pdf/csv/xlsx server-side and persist each to
   * storage (replaces the old client "generate & upload all" flow). Returns the
   * stored file rows.
   */
  async generateAndPersistClassSummary(
    studentGroupId: string,
    termId: string,
    reportType: string,
    userId: string,
  ) {
    const formats: SummaryFormat[] = ['pdf', 'csv', 'xlsx'];
    const stored: Awaited<
      ReturnType<ReportService['uploadClassSummaryFile']>
    >[] = [];
    for (const format of formats) {
      const { buffer } = await this.getClassSummaryFile(
        studentGroupId,
        termId,
        reportType,
        format,
      );
      const row = await this.reportService.uploadClassSummaryFile(
        studentGroupId,
        termId,
        reportType,
        format,
        userId,
        buffer,
      );
      stored.push(row);
    }
    return stored;
  }
}
