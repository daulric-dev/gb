import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { SupabaseService } from '@/supabase/supabase.service';
import { CalculationService } from '@/calculation/calculation.service';
import { FileQueueService } from '@/queue/file-queue.service';
import { StudentTermResult } from '@/calculation/interfaces/calculation.interfaces';
import { GenerateReportDto } from './dto/generate-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { UpdateReportEntryDto } from './dto/update-report-entry.dto';
import { SavePdfDto } from './dto/save-pdf.dto';

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly calculationService: CalculationService,
    private readonly fileQueue: FileQueueService,
  ) {}

  async generateTermReports(
    _userId: string,
    dto: GenerateReportDto,
  ): Promise<{ generated: number; message: string }> {
    const serviceClient = this.supabaseService.getServiceClient();

    const { data: group, error: groupError } = await serviceClient
      .from('student_group')
      .select('academic_year_id')
      .eq('id', dto.studentGroupId)
      .maybeSingle();

    if (groupError) {
      this.logger.error(
        `Failed to load student group ${dto.studentGroupId}: ${groupError.message}`,
      );
      throw new BadRequestException(
        'Could not load class for report generation',
      );
    }

    const academicYearId = group?.academic_year_id;
    if (!academicYearId) {
      throw new BadRequestException(
        'Class has no academic year; cannot generate reports',
      );
    }

    let studentIds: string[];
    if (dto.studentId) {
      studentIds = [dto.studentId];
    } else {
      const { data: enrollments, error: enrError } = await serviceClient
        .schema('student')
        .from('student_group_enrollment')
        .select('student_id')
        .eq('student_group_id', dto.studentGroupId);

      if (enrError) {
        this.logger.error(`Failed to load enrollments: ${enrError.message}`);
        throw new BadRequestException('Could not load class enrollments');
      }

      studentIds = (enrollments ?? []).map(
        (e: { student_id: string }) => e.student_id,
      );
    }

    if (studentIds.length === 0) {
      return { generated: 0, message: 'Reports generated' };
    }

    // Compute the whole class once (batched + Redis-cached) instead of issuing
    // ~5+5×subjects queries per student in a loop. Positions/ranks are class-wide
    // and already assigned by the calculation service.
    const classResults =
      await this.calculationService.calculateClassTermResults(
        dto.termId,
        dto.studentGroupId,
      );
    const resultByStudentId = new Map(
      classResults.map((r) => [r.studentId, r]),
    );
    const totalStudents = classResults.length;

    // Year-end grades: one batched call for the whole class, keyed by student.
    const yearGradeMaps = new Map<string, Map<string, number | null>>();
    if (dto.reportType === 'year_end') {
      const classYear = await this.calculationService.calculateClassYearResults(
        academicYearId,
        dto.studentGroupId,
      );
      for (const yr of classYear) {
        const m = new Map<string, number | null>();
        for (const ys of yr.yearEnd.subjects) m.set(ys.subjectId, ys.yearGrade);
        yearGradeMaps.set(yr.studentId, m);
      }
    }

    const targetResults = studentIds
      .map((id) => resultByStudentId.get(id))
      .filter((r): r is StudentTermResult => !!r);

    if (targetResults.length === 0) {
      return { generated: 0, message: 'Reports generated' };
    }

    // Bulk-upsert every report book in one round-trip, then map student → book id.
    const bookRows = targetResults.map((result) => ({
      student_id: result.studentId,
      academic_year_id: academicYearId,
      term_id: dto.termId,
      student_group_id: dto.studentGroupId,
      report_type: dto.reportType,
      status: 'draft',
      overall_average: result.overallAverage,
      position: result.position ?? null,
      total_students: totalStudents,
    }));

    const { data: books, error: bookErr } = await serviceClient
      .schema('reporting')
      .from('report_book')
      .upsert(bookRows, { onConflict: 'student_id,term_id,report_type' })
      .select('id, student_id');

    if (bookErr) {
      this.logger.error(`Failed to upsert report books: ${bookErr.message}`);
      throw new BadRequestException(bookErr.message);
    }

    const bookIdByStudentId = new Map<string, string>();
    for (const b of books ?? []) {
      bookIdByStudentId.set(b.student_id as string, b.id as string);
    }

    // Build every entry across all students, then upsert them in one round-trip.
    const entryRows = targetResults.flatMap((result) => {
      const reportBookId = bookIdByStudentId.get(result.studentId);
      if (!reportBookId) return [];
      const yearMap = yearGradeMaps.get(result.studentId);
      return result.subjects.map((subject, subjectIndex) => ({
        report_book_id: reportBookId,
        subject_id: subject.subjectId,
        coursework_average: subject.courseworkAverage,
        exam_average: subject.examAverage,
        term_composite: subject.termComposite,
        year_grade:
          dto.reportType === 'year_end' && yearMap
            ? (yearMap.get(subject.subjectId) ?? null)
            : null,
        sort_order: subjectIndex,
      }));
    });

    if (entryRows.length > 0) {
      const { error: entryErr } = await serviceClient
        .schema('reporting')
        .from('report_book_entry')
        .upsert(entryRows, { onConflict: 'report_book_id,subject_id' });

      if (entryErr) {
        this.logger.error(
          `Failed to upsert report entries: ${entryErr.message}`,
        );
        throw new BadRequestException(entryErr.message);
      }
    }

    return {
      generated: targetResults.length,
      message: 'Reports generated',
    };
  }

  async findByClassAndTerm(
    studentGroupId: string,
    termId: string,
    req: FastifyRequest,
    reply: FastifyReply,
    reportType?: string,
  ) {
    const supabase = this.supabaseService.createUserClient(
      req,
      reply,
      'reporting',
    );

    let query = supabase
      .from('report_book')
      .select('*')
      .eq('student_group_id', studentGroupId)
      .eq('term_id', termId);

    if (reportType) {
      query = query.eq('report_type', reportType);
    }

    const { data: reports, error } = await query.order('position', {
      ascending: true,
    });

    if (error) {
      this.logger.error(`findByClassAndTerm: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    const list = reports ?? [];
    const studentIds = list
      .map((r: { student_id: string | null }) => r.student_id)
      .filter((id): id is string => Boolean(id));

    const studentMap = await this.fetchStudentsByIdsForUser(
      req,
      reply,
      studentIds,
      'id, first_name, last_name',
    );

    return list.map((r: { student_id: string | null }) => ({
      ...r,
      student:
        r.student_id && studentMap.has(r.student_id)
          ? studentMap.get(r.student_id)
          : null,
    }));
  }

  async findOne(reportId: string, req: FastifyRequest, reply: FastifyReply) {
    const supabase = this.supabaseService.createUserClient(
      req,
      reply,
      'reporting',
    );

    const { data: report, error } = await supabase
      .from('report_book')
      .select('*')
      .eq('id', reportId)
      .maybeSingle();

    if (error) {
      this.logger.error(`findOne: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    let student: Record<string, unknown> | null = null;
    if (report.student_id) {
      const stMap = await this.fetchStudentsByIdsForUser(
        req,
        reply,
        [report.student_id],
        'id, first_name, last_name, gender, date_of_birth',
      );
      student = stMap.get(report.student_id) ?? null;
    }

    const { entries, pdfs } = await this.loadReportEntriesAndPdfs(
      reportId,
      req,
      reply,
    );

    return { ...report, student, entries, pdfs };
  }

  async findStudentReport(
    studentId: string,
    termId: string,
    reportType: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    const supabase = this.supabaseService.createUserClient(
      req,
      reply,
      'reporting',
    );

    const { data: report, error } = await supabase
      .from('report_book')
      .select('*')
      .eq('student_id', studentId)
      .eq('term_id', termId)
      .eq('report_type', reportType)
      .maybeSingle();

    if (error) {
      this.logger.error(`findStudentReport: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    if (!report) {
      return null;
    }

    let student: Record<string, unknown> | null = null;
    if (report.student_id) {
      const stMap = await this.fetchStudentsByIdsForUser(
        req,
        reply,
        [report.student_id],
        'id, first_name, last_name, gender, date_of_birth',
      );
      student = stMap.get(report.student_id) ?? null;
    }

    const { entries, pdfs } = await this.loadReportEntriesAndPdfs(
      report.id as string,
      req,
      reply,
    );

    return { ...report, student, entries, pdfs };
  }

  async updateReport(userId: string, reportId: string, dto: UpdateReportDto) {
    const serviceClient = this.supabaseService.getServiceClient();
    await this.assertReportInCallerSchool(reportId, userId);
    const updateData: Record<string, unknown> = {};
    if (dto.classTeacherRemark !== undefined) {
      updateData.class_teacher_remark = dto.classTeacherRemark;
    }
    if (dto.conduct !== undefined) {
      updateData.conduct = dto.conduct;
    }
    if (dto.attendancePercentage !== undefined) {
      updateData.attendance_percentage = dto.attendancePercentage;
    }

    const { data, error } = await serviceClient
      .schema('reporting')
      .from('report_book')
      .update(updateData)
      .eq('id', reportId)
      .select()
      .single();

    if (error) {
      this.logger.error(`updateReport: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    return data;
  }

  async updateReportEntry(
    entryId: string,
    dto: UpdateReportEntryDto,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    const supabase = this.supabaseService.createUserClient(
      req,
      reply,
      'reporting',
    );
    const updateData: Record<string, unknown> = {};
    if (dto.teacherRemark !== undefined) {
      updateData.teacher_remark = dto.teacherRemark;
    }
    if (dto.letterGrade !== undefined) {
      updateData.letter_grade = dto.letterGrade;
    }

    const { data, error } = await supabase
      .from('report_book_entry')
      .update(updateData)
      .eq('id', entryId)
      .select()
      .single();

    if (error) {
      if (
        error.code === '42501' ||
        error.message?.includes('row-level security')
      ) {
        throw new ForbiddenException('You cannot update this report entry');
      }
      this.logger.error(`updateReportEntry: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    return data;
  }

  async publish(userId: string, reportId: string) {
    const serviceClient = this.supabaseService.getServiceClient();
    await this.assertReportInCallerSchool(reportId, userId);

    const { data: existing, error: fetchError } = await serviceClient
      .schema('reporting')
      .from('report_book')
      .select('status')
      .eq('id', reportId)
      .maybeSingle();

    if (fetchError) {
      this.logger.error(`publish fetch: ${fetchError.message}`);
      throw new BadRequestException(fetchError.message);
    }

    if (!existing) {
      throw new NotFoundException('Report not found');
    }

    if (
      existing.status === 'published' ||
      existing.status === 'sent_to_ministry'
    ) {
      throw new BadRequestException('Report is already published');
    }

    const { data, error } = await serviceClient
      .schema('reporting')
      .from('report_book')
      .update({ status: 'published' })
      .eq('id', reportId)
      .select()
      .single();

    if (error) {
      this.logger.error(`publish: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    return data;
  }

  async sendToMinistry(userId: string, reportId: string) {
    const serviceClient = this.supabaseService.getServiceClient();
    await this.assertReportInCallerSchool(reportId, userId);

    const { data: existing, error: fetchError } = await serviceClient
      .schema('reporting')
      .from('report_book')
      .select('status')
      .eq('id', reportId)
      .maybeSingle();

    if (fetchError) {
      this.logger.error(`sendToMinistry fetch: ${fetchError.message}`);
      throw new BadRequestException(fetchError.message);
    }

    if (!existing) {
      throw new NotFoundException('Report not found');
    }

    if (existing.status === 'draft') {
      throw new BadRequestException(
        'Report must be published before sending to ministry',
      );
    }

    if (existing.status === 'sent_to_ministry') {
      throw new BadRequestException('Report already sent to ministry');
    }

    const { data, error } = await serviceClient
      .schema('reporting')
      .from('report_book')
      .update({ status: 'sent_to_ministry' })
      .eq('id', reportId)
      .select()
      .single();

    if (error) {
      this.logger.error(`sendToMinistry: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    return data;
  }

  async regenerateReport(userId: string, reportId: string) {
    const serviceClient = this.supabaseService.getServiceClient();
    await this.assertReportInCallerSchool(reportId, userId);

    const { data: reportRow, error: loadError } = await serviceClient
      .schema('reporting')
      .from('report_book')
      .select(
        'id, student_id, term_id, student_group_id, report_type, status, academic_year_id',
      )
      .eq('id', reportId)
      .maybeSingle();

    if (loadError) {
      this.logger.error(`regenerateReport load: ${loadError.message}`);
      throw new BadRequestException(loadError.message);
    }

    if (!reportRow) {
      throw new NotFoundException('Report not found');
    }

    if (reportRow.status === 'sent_to_ministry') {
      throw new ForbiddenException(
        'Cannot regenerate a report sent to ministry',
      );
    }

    const {
      student_id,
      term_id,
      student_group_id,
      report_type,
      academic_year_id,
    } = reportRow;

    const { data: cohort, error: cohortError } = await serviceClient
      .schema('reporting')
      .from('report_book')
      .select('id, student_id, status')
      .eq('student_group_id', student_group_id)
      .eq('term_id', term_id)
      .eq('report_type', report_type);

    if (cohortError) {
      this.logger.error(`regenerateReport cohort: ${cohortError.message}`);
      throw new BadRequestException(cohortError.message);
    }

    if (!cohort?.length) {
      throw new BadRequestException('No reports found for this class and term');
    }

    type RankRow = {
      reportId: string;
      studentId: string;
      overallAverage: number | null;
      lastName: string;
    };

    const classResults =
      await this.calculationService.calculateClassTermResults(
        term_id,
        student_group_id,
      );
    const resultByStudentId = new Map(
      classResults.map((r) => [r.studentId, r]),
    );

    const rankRows: RankRow[] = cohort.map((row) => {
      const r = resultByStudentId.get(row.student_id);
      return {
        reportId: row.id,
        studentId: row.student_id,
        overallAverage: r?.overallAverage ?? null,
        lastName: r?.lastName ?? '',
      };
    });

    rankRows.sort((a, b) => {
      const diff = (b.overallAverage ?? -1) - (a.overallAverage ?? -1);
      if (diff !== 0) return diff;
      return (a.lastName ?? '').localeCompare(b.lastName ?? '');
    });

    const totalStudents = rankRows.length;

    const lockedIds = new Set(
      cohort
        .filter((r: { status: string }) => r.status === 'sent_to_ministry')
        .map((r: { id: string }) => r.id),
    );

    const rankUpdates = rankRows.flatMap((rankRow, i) => {
      if (lockedIds.has(rankRow.reportId)) return [];
      return [
        serviceClient
          .schema('reporting')
          .from('report_book')
          .update({
            overall_average: rankRow.overallAverage,
            position: i + 1,
            total_students: totalStudents,
          })
          .eq('id', rankRow.reportId)
          .then(({ error }) => {
            if (error) {
              this.logger.error(
                `regenerateReport rank update: ${error.message}`,
              );
              throw new BadRequestException(error.message);
            }
          }),
      ];
    });
    await Promise.all(rankUpdates);

    const termResult =
      resultByStudentId.get(student_id) ??
      (await this.calculationService.calculateStudentTermResult(
        student_id,
        term_id,
        student_group_id,
      ));

    let yearGradeMap: Map<string, number | null> | null = null;
    if (report_type === 'year_end' && academic_year_id) {
      const classYear = await this.calculationService.calculateClassYearResults(
        academic_year_id,
        student_group_id,
      );
      const yr = classYear.find((y) => y.studentId === student_id);
      if (yr) {
        yearGradeMap = new Map(
          yr.yearEnd.subjects.map((s) => [s.subjectId, s.yearGrade]),
        );
      }
    }

    const entryRows = termResult.subjects.map((subject, subjectIndex) => ({
      report_book_id: reportId,
      subject_id: subject.subjectId,
      coursework_average: subject.courseworkAverage,
      exam_average: subject.examAverage,
      term_composite: subject.termComposite,
      year_grade:
        report_type === 'year_end' && yearGradeMap
          ? (yearGradeMap.get(subject.subjectId) ?? null)
          : null,
      sort_order: subjectIndex,
    }));

    if (entryRows.length > 0) {
      const { error: entryErr } = await serviceClient
        .schema('reporting')
        .from('report_book_entry')
        .upsert(entryRows, { onConflict: 'report_book_id,subject_id' });

      if (entryErr) {
        this.logger.error(`regenerateReport entry upsert: ${entryErr.message}`);
        throw new BadRequestException(entryErr.message);
      }
    }

    return this.loadFullReportWithServiceClient(reportId);
  }

  async savePdf(reportId: string, userId: string, dto: SavePdfDto) {
    const serviceClient = this.supabaseService.getServiceClient();

    const { data, error } = await serviceClient
      .schema('reporting')
      .from('report_book_pdf')
      .insert({
        report_book_id: reportId,
        file_path: dto.filePath,
        file_size: dto.fileSize,
        generated_by: userId,
        generated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`savePdf: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    return data;
  }

  private static readonly PDF_BUCKET = 'report-books';

  /** Upload a PDF buffer to Supabase Storage and record metadata. */
  async uploadPdf(reportId: string, userId: string, fileBuffer: Buffer) {
    const serviceClient = this.supabaseService.getServiceClient();

    const objectPath = `${reportId}/${Date.now()}-${crypto.randomUUID()}.pdf`;

    await this.supabaseService.scanOrThrow(fileBuffer, objectPath);

    const { error: uploadError } = await serviceClient.storage
      .from(ReportService.PDF_BUCKET)
      .upload(objectPath, fileBuffer, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      this.logger.error(`uploadPdf storage: ${uploadError.message}`);
      throw new BadRequestException(
        `Storage upload failed: ${uploadError.message}`,
      );
    }

    const { data, error } = await serviceClient
      .schema('reporting')
      .from('report_book_pdf')
      .insert({
        report_book_id: reportId,
        file_path: objectPath,
        file_size: fileBuffer.length,
        generated_by: userId,
        generated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`uploadPdf record: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    // Surface the generated report in the owner's file manager.
    await this.enqueueFileManagerIngest({
      userId,
      storagePath: objectPath,
      name: `Report card (${new Date().toISOString().slice(0, 10)}).pdf`,
      contentType: 'application/pdf',
      sizeBytes: fileBuffer.length,
      sourceRef: reportId,
    });

    return data;
  }

  /**
   * Best-effort hand-off of a stored report object to the file-manager ingest
   * queue, so it appears in the owner's Files. Out of band: a queue/storage
   * hiccup here must never fail report generation.
   */
  private async enqueueFileManagerIngest(params: {
    userId: string;
    storagePath: string;
    name: string;
    contentType: string;
    sizeBytes: number;
    sourceRef?: string;
  }): Promise<void> {
    try {
      const schoolId = await this.supabaseService.getUserSchoolId(
        params.userId,
      );
      await this.fileQueue.enqueueIngest({
        schoolId,
        ownerId: params.userId,
        bucket: ReportService.PDF_BUCKET,
        storagePath: params.storagePath,
        name: params.name,
        contentType: params.contentType,
        sizeBytes: params.sizeBytes,
        sourceRef: params.sourceRef,
        // File generated reports under Reports/<generation date> in the owner's
        // file manager. Folders are created on demand by the ingest handler.
        folderPath: ['Reports', new Date().toISOString().slice(0, 10)],
      });
    } catch (err) {
      this.logger.warn(
        `Could not enqueue file-manager ingest for ${params.storagePath}: ${(err as Error).message}`,
      );
    }
  }

  /** Download a PDF from Supabase Storage and return the raw bytes. */
  async downloadPdf(reportId: string, pdfId: string) {
    const serviceClient = this.supabaseService.getServiceClient();

    const { data: pdfRow, error: fetchError } = await serviceClient
      .schema('reporting')
      .from('report_book_pdf')
      .select('file_path, report_book_id')
      .eq('id', pdfId)
      .maybeSingle();

    if (fetchError) {
      this.logger.error(`downloadPdf fetch: ${fetchError.message}`);
      throw new BadRequestException(fetchError.message);
    }

    if (!pdfRow) {
      throw new NotFoundException('PDF record not found');
    }

    if (pdfRow.report_book_id !== reportId) {
      throw new NotFoundException('PDF record not found');
    }

    const { data, error: dlError } = await serviceClient.storage
      .from(ReportService.PDF_BUCKET)
      .download(pdfRow.file_path);

    if (dlError) {
      this.logger.error(`downloadPdf storage: ${dlError.message}`);
      throw new BadRequestException(
        `Storage download failed: ${dlError.message}`,
      );
    }

    const arrayBuffer = await data.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      filename: pdfRow.file_path.split('/').pop() ?? 'report.pdf',
    };
  }

  async getPdfHistory(
    reportId: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    const supabase = this.supabaseService.createUserClient(
      req,
      reply,
      'reporting',
    );

    const { data: rows, error } = await supabase
      .from('report_book_pdf')
      .select('*')
      .eq('report_book_id', reportId)
      .order('generated_at', { ascending: false });

    if (error) {
      this.logger.error(`getPdfHistory: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    const list = rows ?? [];
    const userIds = [
      ...new Set(
        list
          .map((r: { generated_by: string | null }) => r.generated_by)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const profileMap = await this.fetchUserProfilesByIdsForUser(
      req,
      reply,
      userIds,
    );

    return list.map((r: { generated_by: string | null }) => ({
      ...r,
      generated_by_user: r.generated_by
        ? (profileMap.get(r.generated_by) ?? null)
        : null,
    }));
  }

  async getLatestPdf(
    reportId: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    const supabase = this.supabaseService.createUserClient(
      req,
      reply,
      'reporting',
    );

    const { data, error } = await supabase
      .from('report_book_pdf')
      .select('*')
      .eq('report_book_id', reportId)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.error(`getLatestPdf: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    return data;
  }

  async getClassSummary(
    studentGroupId: string,
    termId: string,
    reportType: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    const reporting = this.supabaseService.createUserClient(
      req,
      reply,
      'reporting',
    );
    const pub = this.supabaseService.createUserClient(req, reply, 'public');

    let query = reporting
      .from('report_book')
      .select('id, student_id, overall_average, position, total_students')
      .eq('student_group_id', studentGroupId)
      .eq('term_id', termId);

    if (reportType) {
      query = query.eq('report_type', reportType);
    }

    const { data: reports, error } = await query.order('position', {
      ascending: true,
    });
    if (error) {
      this.logger.error(`getClassSummary reports: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    const list = reports ?? [];
    if (list.length === 0) {
      return {
        classAverage: null,
        highestAverage: null,
        lowestAverage: null,
        totalStudents: 0,
        passCount: 0,
        failCount: 0,
        courseworkWeight: 50,
        examWeight: 50,
        gradingModel: 'weighted_continuous',
        subjectAverages: [],
        students: [],
      };
    }

    const { data: termRow } = await pub
      .from('term')
      .select('coursework_weight, exam_weight, academic_year_id')
      .eq('id', termId)
      .single();

    let courseworkWeight = termRow?.coursework_weight ?? 50;
    let examWeight = termRow?.exam_weight ?? 50;
    let gradingModel = 'weighted_continuous';

    if (termRow?.academic_year_id) {
      const { data: ayRow } = await pub
        .from('academic_year')
        .select('grading_model, year_coursework_weight, year_exam_weight')
        .eq('id', termRow.academic_year_id)
        .single();
      gradingModel = ayRow?.grading_model ?? 'weighted_continuous';

      if (reportType === 'year_end' && gradingModel !== 'weighted_continuous') {
        courseworkWeight = ayRow?.year_coursework_weight ?? 50;
        examWeight = ayRow?.year_exam_weight ?? 50;
      }
    }

    const studentIds = list
      .map((r: { student_id: string | null }) => r.student_id)
      .filter((id): id is string => Boolean(id));
    const studentMap = await this.fetchStudentsByIdsForUser(
      req,
      reply,
      studentIds,
      'id, first_name, last_name',
    );

    const reportIds = list.map((r: { id: string }) => r.id);
    const { data: entryRows, error: entryErr } = await reporting
      .from('report_book_entry')
      .select(
        'report_book_id, subject_id, coursework_average, exam_average, term_composite, year_grade, sort_order',
      )
      .in('report_book_id', reportIds)
      .order('sort_order', { ascending: true });

    if (entryErr) {
      this.logger.error(`getClassSummary entries: ${entryErr.message}`);
      throw new BadRequestException(entryErr.message);
    }

    const subjectIds = [
      ...new Set(
        (entryRows ?? [])
          .map((e: { subject_id: string | null }) => e.subject_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const subjectMap = await this.fetchSubjectsByIdsForUser(
      req,
      reply,
      subjectIds,
    );

    const averages = list
      .map((r: { overall_average: number | null }) => r.overall_average)
      .filter((a): a is number => a != null);

    const classAverage =
      averages.length > 0
        ? averages.reduce((s, v) => s + v, 0) / averages.length
        : null;
    const highestAverage = averages.length > 0 ? Math.max(...averages) : null;
    const lowestAverage = averages.length > 0 ? Math.min(...averages) : null;
    const passCount = averages.filter((a) => a >= 50).length;
    const failCount = averages.filter((a) => a < 50).length;

    type EntryShape = {
      report_book_id: string;
      subject_id: string;
      coursework_average: number | null;
      exam_average: number | null;
      term_composite: number | null;
      year_grade: number | null;
    };

    const isYearEnd =
      reportType === 'year_end' && gradingModel !== 'weighted_continuous';
    const subjectScores = new Map<string, number[]>();
    for (const e of (entryRows ?? []) as EntryShape[]) {
      const score = isYearEnd ? e.year_grade : e.term_composite;
      if (score == null) continue;
      const arr = subjectScores.get(e.subject_id) ?? [];
      arr.push(score);
      subjectScores.set(e.subject_id, arr);
    }

    const subjectAverages = [...subjectScores.entries()].map(
      ([sid, scores]) => {
        const sub = subjectMap.get(sid);
        return {
          subjectId: sid,
          subjectName: (sub as { name?: string })?.name ?? 'Unknown',
          average: scores.reduce((s, v) => s + v, 0) / scores.length,
          highestMark: Math.max(...scores),
          lowestMark: Math.min(...scores),
        };
      },
    );

    const entriesByReport = new Map<string, EntryShape[]>();
    for (const e of (entryRows ?? []) as EntryShape[]) {
      const arr = entriesByReport.get(e.report_book_id) ?? [];
      arr.push(e);
      entriesByReport.set(e.report_book_id, arr);
    }

    const students = list.map(
      (r: {
        id: string;
        student_id: string | null;
        overall_average: number | null;
        position: number | null;
      }) => {
        const st = r.student_id ? studentMap.get(r.student_id) : null;
        const entries = entriesByReport.get(r.id) ?? [];
        return {
          studentId: r.student_id,
          firstName: (st as { first_name?: string })?.first_name ?? '',
          lastName: (st as { last_name?: string })?.last_name ?? '',
          overallAverage: r.overall_average,
          position: r.position,
          subjects: entries.map((e) => {
            const sub = subjectMap.get(e.subject_id);
            return {
              subjectId: e.subject_id,
              subjectName: (sub as { name?: string })?.name ?? 'Unknown',
              courseworkAverage: e.coursework_average,
              examAverage: e.exam_average,
              termComposite: e.term_composite,
              yearGrade: e.year_grade,
            };
          }),
        };
      },
    );

    return {
      classAverage:
        classAverage != null ? Math.round(classAverage * 100) / 100 : null,
      highestAverage,
      lowestAverage,
      totalStudents: list.length,
      passCount,
      failCount,
      courseworkWeight,
      examWeight,
      gradingModel,
      subjectAverages,
      students,
    };
  }

  async uploadClassSummaryFile(
    studentGroupId: string,
    termId: string,
    reportType: string,
    fileType: string,
    userId: string,
    fileBuffer: Buffer,
  ) {
    const serviceClient = this.supabaseService.getServiceClient();
    const ext =
      fileType === 'xlsx' ? 'xlsx' : fileType === 'csv' ? 'csv' : 'pdf';
    const objectPath = `${studentGroupId}/${termId}/class-summary.${ext}`;

    const contentTypeMap: Record<string, string> = {
      pdf: 'application/pdf',
      csv: 'text/csv',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };

    await this.supabaseService.scanOrThrow(fileBuffer, objectPath);

    const { error: uploadError } = await serviceClient.storage
      .from(ReportService.PDF_BUCKET)
      .upload(objectPath, fileBuffer, {
        contentType: contentTypeMap[ext] ?? 'application/octet-stream',
        upsert: true,
      });

    if (uploadError) {
      this.logger.error(
        `uploadClassSummaryFile storage: ${uploadError.message}`,
      );
      throw new BadRequestException(
        `Storage upload failed: ${uploadError.message}`,
      );
    }

    const { data: existing } = await serviceClient
      .schema('reporting')
      .from('class_report_file')
      .select('id')
      .eq('student_group_id', studentGroupId)
      .eq('term_id', termId)
      .eq('report_type', reportType)
      .eq('file_type', ext)
      .maybeSingle();

    if (existing?.id) {
      const { data, error } = await serviceClient
        .schema('reporting')
        .from('class_report_file')
        .update({
          file_path: objectPath,
          file_size: fileBuffer.length,
          generated_by: userId,
          generated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        this.logger.error(`uploadClassSummaryFile update: ${error.message}`);
        throw new BadRequestException(error.message);
      }

      await this.enqueueFileManagerIngest({
        userId,
        storagePath: objectPath,
        name: `Class summary (${ext.toUpperCase()}).${ext}`,
        contentType: contentTypeMap[ext] ?? 'application/octet-stream',
        sizeBytes: fileBuffer.length,
        sourceRef: existing.id,
      });

      return data;
    }

    const { data, error } = await serviceClient
      .schema('reporting')
      .from('class_report_file')
      .insert({
        student_group_id: studentGroupId,
        term_id: termId,
        report_type: reportType,
        file_type: ext,
        file_path: objectPath,
        file_size: fileBuffer.length,
        generated_by: userId,
        generated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`uploadClassSummaryFile insert: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    await this.enqueueFileManagerIngest({
      userId,
      storagePath: objectPath,
      name: `Class summary (${ext.toUpperCase()}).${ext}`,
      contentType: contentTypeMap[ext] ?? 'application/octet-stream',
      sizeBytes: fileBuffer.length,
      sourceRef: data?.id,
    });

    return data;
  }

  async downloadClassSummaryFile(
    studentGroupId: string,
    termId: string,
    reportType: string,
    fileType: string,
  ) {
    const serviceClient = this.supabaseService.getServiceClient();

    const { data: fileRow, error: fetchError } = await serviceClient
      .schema('reporting')
      .from('class_report_file')
      .select('file_path, file_type')
      .eq('student_group_id', studentGroupId)
      .eq('term_id', termId)
      .eq('report_type', reportType)
      .eq('file_type', fileType)
      .maybeSingle();

    if (fetchError) {
      this.logger.error(
        `downloadClassSummaryFile fetch: ${fetchError.message}`,
      );
      throw new BadRequestException(fetchError.message);
    }

    if (!fileRow) {
      throw new NotFoundException('File not found');
    }

    const { data, error: dlError } = await serviceClient.storage
      .from(ReportService.PDF_BUCKET)
      .download(fileRow.file_path);

    if (dlError) {
      this.logger.error(`downloadClassSummaryFile storage: ${dlError.message}`);
      throw new BadRequestException(
        `Storage download failed: ${dlError.message}`,
      );
    }

    const contentTypeMap: Record<string, string> = {
      pdf: 'application/pdf',
      csv: 'text/csv',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };

    const arrayBuffer = await data.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      filename:
        fileRow.file_path.split('/').pop() ?? `class-summary.${fileType}`,
      contentType: contentTypeMap[fileType] ?? 'application/octet-stream',
    };
  }

  async getClassSummaryFiles(
    studentGroupId: string,
    termId: string,
    reportType: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    const supabase = this.supabaseService.createUserClient(
      req,
      reply,
      'reporting',
    );

    const { data, error } = await supabase
      .from('class_report_file')
      .select('*')
      .eq('student_group_id', studentGroupId)
      .eq('term_id', termId)
      .eq('report_type', reportType)
      .order('generated_at', { ascending: false });

    if (error) {
      this.logger.error(`getClassSummaryFiles: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    return data ?? [];
  }

  private async assertReportInCallerSchool(reportId: string, userId: string) {
    const serviceClient = this.supabaseService.getServiceClient();
    const callerSchoolId = await this.supabaseService.getUserSchoolId(userId);

    const { data: report, error } = await serviceClient
      .schema('reporting')
      .from('report_book')
      .select('academic_year:academic_year_id(school_id)')
      .eq('id', reportId)
      .maybeSingle();

    if (error) {
      this.logger.error(`assertReportInCallerSchool fetch: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    const reportSchoolId = (
      report.academic_year as { school_id?: string } | null
    )?.school_id;

    if (!reportSchoolId || reportSchoolId !== callerSchoolId) {
      this.logger.warn(
        `User ${userId} denied cross-school report mutation on ${reportId}`,
      );
      throw new ForbiddenException(
        'You cannot modify reports from another school',
      );
    }
  }

  private async loadFullReportWithServiceClient(reportId: string) {
    const serviceClient = this.supabaseService.getServiceClient();

    const { data: report, error } = await serviceClient
      .schema('reporting')
      .from('report_book')
      .select('*')
      .eq('id', reportId)
      .maybeSingle();

    if (error) {
      this.logger.error(`loadFullReportWithServiceClient: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    let student: Record<string, unknown> | null = null;
    if (report.student_id) {
      const { data: st } = await serviceClient
        .schema('student')
        .from('student')
        .select('id, first_name, last_name, gender, date_of_birth')
        .eq('id', report.student_id)
        .maybeSingle();
      student = st ?? null;
    }

    const { entries, pdfs } =
      await this.loadReportEntriesAndPdfsServiceRole(reportId);

    return { ...report, student, entries, pdfs };
  }

  private async loadReportEntriesAndPdfsServiceRole(reportBookId: string) {
    const serviceClient = this.supabaseService.getServiceClient();

    const { data: entryRows, error: entriesError } = await serviceClient
      .schema('reporting')
      .from('report_book_entry')
      .select('*')
      .eq('report_book_id', reportBookId)
      .order('sort_order', { ascending: true });

    if (entriesError) {
      this.logger.error(
        `loadReportEntriesAndPdfsServiceRole entries: ${entriesError.message}`,
      );
      throw new BadRequestException(entriesError.message);
    }

    const rawEntries = entryRows ?? [];
    const subjectIds = rawEntries
      .map((e: { subject_id: string | null }) => e.subject_id)
      .filter((id): id is string => Boolean(id));
    const subjectMap = await this.fetchSubjectsByIdsServiceRole(subjectIds);

    const entries = rawEntries.map((e: { subject_id: string | null }) => ({
      ...e,
      subject:
        e.subject_id && subjectMap.has(e.subject_id)
          ? subjectMap.get(e.subject_id)
          : null,
    }));

    const { data: pdfs, error: pdfsError } = await serviceClient
      .schema('reporting')
      .from('report_book_pdf')
      .select('*')
      .eq('report_book_id', reportBookId)
      .order('generated_at', { ascending: false });

    if (pdfsError) {
      this.logger.error(
        `loadReportEntriesAndPdfsServiceRole pdfs: ${pdfsError.message}`,
      );
      throw new BadRequestException(pdfsError.message);
    }

    return {
      entries,
      pdfs: pdfs ?? [],
    };
  }

  private async loadReportEntriesAndPdfs(
    reportBookId: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    const reporting = this.supabaseService.createUserClient(
      req,
      reply,
      'reporting',
    );

    const { data: entryRows, error: entriesError } = await reporting
      .from('report_book_entry')
      .select('*')
      .eq('report_book_id', reportBookId)
      .order('sort_order', { ascending: true });

    if (entriesError) {
      this.logger.error(
        `loadReportEntriesAndPdfs entries: ${entriesError.message}`,
      );
      throw new BadRequestException(entriesError.message);
    }

    const rawEntries = entryRows ?? [];
    const subjectIds = rawEntries
      .map((e: { subject_id: string | null }) => e.subject_id)
      .filter((id): id is string => Boolean(id));
    const subjectMap = await this.fetchSubjectsByIdsForUser(
      req,
      reply,
      subjectIds,
    );

    const entries = rawEntries.map((e: { subject_id: string | null }) => ({
      ...e,
      subject:
        e.subject_id && subjectMap.has(e.subject_id)
          ? subjectMap.get(e.subject_id)
          : null,
    }));

    const { data: pdfs, error: pdfsError } = await reporting
      .from('report_book_pdf')
      .select('*')
      .eq('report_book_id', reportBookId)
      .order('generated_at', { ascending: false });

    if (pdfsError) {
      this.logger.error(`loadReportEntriesAndPdfs pdfs: ${pdfsError.message}`);
      throw new BadRequestException(pdfsError.message);
    }

    return {
      entries,
      pdfs: pdfs ?? [],
    };
  }

  /** PostgREST embeds need FK metadata; we query `student.student` explicitly. */
  private async fetchStudentsByIdsForUser(
    req: FastifyRequest,
    reply: FastifyReply,
    ids: string[],
    columns: string,
  ): Promise<Map<string, Record<string, unknown>>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();

    const client = this.supabaseService.createUserClient(req, reply, 'student');
    const { data, error } = await client
      .from('student')
      .select(columns)
      .in('id', unique);

    if (error) {
      this.logger.error(`fetchStudentsByIdsForUser: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    const m = new Map<string, Record<string, unknown>>();
    const rows = (data ?? []) as unknown as { id: string }[];
    for (const row of rows) {
      m.set(row.id, row);
    }
    return m;
  }

  private async fetchSubjectsByIdsForUser(
    req: FastifyRequest,
    reply: FastifyReply,
    ids: string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();

    const client = this.supabaseService.createUserClient(req, reply, 'public');
    const { data, error } = await client
      .from('subject')
      .select('id, name, code, is_graded, sort_order')
      .in('id', unique);

    if (error) {
      this.logger.error(`fetchSubjectsByIdsForUser: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    const m = new Map<string, Record<string, unknown>>();
    const rows = (data ?? []) as unknown as { id: string }[];
    for (const row of rows) {
      m.set(row.id, row);
    }
    return m;
  }

  private async fetchSubjectsByIdsServiceRole(
    ids: string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();

    const c = this.supabaseService.getServiceClient();
    const { data, error } = await c
      .from('subject')
      .select('id, name, code, is_graded, sort_order')
      .in('id', unique);

    if (error) {
      this.logger.error(`fetchSubjectsByIdsServiceRole: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    const m = new Map<string, Record<string, unknown>>();
    const rows = (data ?? []) as unknown as { id: string }[];
    for (const row of rows) {
      m.set(row.id, row);
    }
    return m;
  }

  private async fetchUserProfilesByIdsForUser(
    req: FastifyRequest,
    reply: FastifyReply,
    ids: string[],
  ): Promise<
    Map<string, { id: string; first_name: string; last_name: string }>
  > {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();

    const client = this.supabaseService.createUserClient(req, reply, 'public');
    const { data, error } = await client
      .from('user_profile')
      .select('id, first_name, last_name')
      .in('id', unique);

    if (error) {
      this.logger.error(`fetchUserProfilesByIdsForUser: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    const m = new Map<
      string,
      { id: string; first_name: string; last_name: string }
    >();
    for (const row of data ?? []) {
      m.set(row.id, {
        id: row.id,
        first_name: row.first_name ?? '',
        last_name: row.last_name ?? '',
      });
    }
    return m;
  }
}
