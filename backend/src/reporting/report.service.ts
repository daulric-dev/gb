import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CalculationService } from '@/calculation/calculation.service';
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
      throw new BadRequestException('Could not load class for report generation');
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
        this.logger.error(
          `Failed to load enrollments: ${enrError.message}`,
        );
        throw new BadRequestException('Could not load class enrollments');
      }

      studentIds = (enrollments ?? []).map((e: { student_id: string }) => e.student_id);
    }

    if (studentIds.length === 0) {
      return { generated: 0, message: 'Reports generated' };
    }

    const termResults: StudentTermResult[] = [];
    const yearGradeMaps = new Map<string, Map<string, number | null>>();

    for (const studentId of studentIds) {
      const termResult = await this.calculationService.calculateStudentTermResult(
        studentId,
        dto.termId,
        dto.studentGroupId,
      );
      termResults.push(termResult);

      if (dto.reportType === 'year_end') {
        const yearResult = await this.calculationService.calculateStudentYearResult(
          studentId,
          academicYearId,
          dto.studentGroupId,
        );
        const m = new Map<string, number | null>();
        for (const ys of yearResult.yearEnd.subjects) {
          m.set(ys.subjectId, ys.yearGrade);
        }
        yearGradeMaps.set(studentId, m);
      }
    }

    const sorted = [...termResults].sort((a, b) => {
      const diff = (b.overallAverage ?? -1) - (a.overallAverage ?? -1);
      if (diff !== 0) return diff;
      return (a.lastName ?? '').localeCompare(b.lastName ?? '');
    });

    const rankByStudentId = new Map<string, number>();
    sorted.forEach((r, i) => {
      rankByStudentId.set(r.studentId, i + 1);
    });

    const totalStudents = termResults.length;

    for (const result of termResults) {
      const rank = rankByStudentId.get(result.studentId)!;
      const yearMap = yearGradeMaps.get(result.studentId);

      const reportBookId = await this.upsertReportBookNaturalKey(serviceClient, {
        student_id: result.studentId,
        academic_year_id: academicYearId,
        term_id: dto.termId,
        student_group_id: dto.studentGroupId,
        report_type: dto.reportType,
        status: 'draft',
        overall_average: result.overallAverage,
        position: rank,
        total_students: totalStudents,
      });

      for (let subjectIndex = 0; subjectIndex < result.subjects.length; subjectIndex++) {
        const subject = result.subjects[subjectIndex];
        const yearGrade =
          dto.reportType === 'year_end' && yearMap
            ? (yearMap.get(subject.subjectId) ?? null)
            : null;

        await this.upsertReportEntryNaturalKey(serviceClient, reportBookId, {
          subject_id: subject.subjectId,
          coursework_average: subject.courseworkAverage,
          exam_average: subject.examAverage,
          term_composite: subject.termComposite,
          year_grade: yearGrade,
          sort_order: subjectIndex,
        });
      }
    }

    return {
      generated: studentIds.length,
      message: 'Reports generated',
    };
  }

  async findByClassAndTerm(
    studentGroupId: string,
    termId: string,
    token: string,
  ) {
    const supabase = this.supabaseService.createUserClient(token, 'reporting');

    const { data: reports, error } = await supabase
      .from('report_book')
      .select('*')
      .eq('student_group_id', studentGroupId)
      .eq('term_id', termId)
      .order('position', { ascending: true });

    if (error) {
      this.logger.error(`findByClassAndTerm: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    const list = reports ?? [];
    const studentIds = list
      .map((r: { student_id: string | null }) => r.student_id)
      .filter((id): id is string => Boolean(id));

    const studentMap = await this.fetchStudentsByIdsForUser(
      token,
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

  async findOne(reportId: string, token: string) {
    const supabase = this.supabaseService.createUserClient(token, 'reporting');

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
        token,
        [report.student_id],
        'id, first_name, last_name, gender, date_of_birth',
      );
      student = stMap.get(report.student_id) ?? null;
    }

    const { entries, pdfs } = await this.loadReportEntriesAndPdfs(
      reportId,
      token,
    );

    return { ...report, student, entries, pdfs };
  }

  async findStudentReport(
    studentId: string,
    termId: string,
    reportType: string,
    token: string,
  ) {
    const supabase = this.supabaseService.createUserClient(token, 'reporting');

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
        token,
        [report.student_id],
        'id, first_name, last_name, gender, date_of_birth',
      );
      student = stMap.get(report.student_id) ?? null;
    }

    const { entries, pdfs } = await this.loadReportEntriesAndPdfs(
      report.id as string,
      token,
    );

    return { ...report, student, entries, pdfs };
  }

  async updateReport(reportId: string, dto: UpdateReportDto) {
    const serviceClient = this.supabaseService.getServiceClient();
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

  async updateReportEntry( entryId: string, dto: UpdateReportEntryDto, token: string ) {
    const supabase = this.supabaseService.createUserClient(token, 'reporting');
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
        throw new ForbiddenException(
          'You cannot update this report entry',
        );
      }
      this.logger.error(`updateReportEntry: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    return data;
  }

  async publish(reportId: string) {
    const serviceClient = this.supabaseService.getServiceClient();

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

  async sendToMinistry(reportId: string) {
    const serviceClient = this.supabaseService.getServiceClient();

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

  async regenerateReport(reportId: string) {
    const serviceClient = this.supabaseService.getServiceClient();

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
      .select('id, student_id')
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

    const rankRows: RankRow[] = [];

    for (const row of cohort) {
      const termResult = await this.calculationService.calculateStudentTermResult(
        row.student_id,
        term_id,
        student_group_id,
      );
      rankRows.push({
        reportId: row.id,
        studentId: row.student_id,
        overallAverage: termResult.overallAverage,
        lastName: termResult.lastName,
      });
    }

    rankRows.sort((a, b) => {
      const diff = (b.overallAverage ?? -1) - (a.overallAverage ?? -1);
      if (diff !== 0) return diff;
      return (a.lastName ?? '').localeCompare(b.lastName ?? '');
    });

    const totalStudents = rankRows.length;

    for (let i = 0; i < rankRows.length; i++) {
      const { reportId: rid, overallAverage } = rankRows[i];
      const { error: rankError } = await serviceClient
        .schema('reporting')
        .from('report_book')
        .update({
          overall_average: overallAverage,
          position: i + 1,
          total_students: totalStudents,
        })
        .eq('id', rid);

      if (rankError) {
        this.logger.error(`regenerateReport rank update: ${rankError.message}`);
        throw new BadRequestException(rankError.message);
      }
    }

    const termResult = await this.calculationService.calculateStudentTermResult(
      student_id,
      term_id,
      student_group_id,
    );

    let yearGradeMap: Map<string, number | null> | null = null;
    if (report_type === 'year_end' && academic_year_id) {
      const yearResult = await this.calculationService.calculateStudentYearResult(
        student_id,
        academic_year_id,
        student_group_id,
      );
      yearGradeMap = new Map(
        yearResult.yearEnd.subjects.map((s) => [s.subjectId, s.yearGrade]),
      );
    }

    for (let subjectIndex = 0; subjectIndex < termResult.subjects.length; subjectIndex++) {
      const subject = termResult.subjects[subjectIndex];
      const yearGrade =
        report_type === 'year_end' && yearGradeMap
          ? (yearGradeMap.get(subject.subjectId) ?? null)
          : null;

      await this.upsertReportEntryNaturalKey(serviceClient, reportId, {
        subject_id: subject.subjectId,
        coursework_average: subject.courseworkAverage,
        exam_average: subject.examAverage,
        term_composite: subject.termComposite,
        year_grade: yearGrade,
        sort_order: subjectIndex,
      });
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

  async getPdfHistory(reportId: string, token: string) {
    const supabase = this.supabaseService.createUserClient(token, 'reporting');

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
    const profileMap = await this.fetchUserProfilesByIdsForUser(token, userIds);

    return list.map((r: { generated_by: string | null }) => ({
      ...r,
      generated_by_user: r.generated_by
        ? (profileMap.get(r.generated_by) ?? null)
        : null,
    }));
  }

  async getLatestPdf(reportId: string, token: string) {
    const supabase = this.supabaseService.createUserClient(token, 'reporting');

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
        .select(
          'id, first_name, last_name, gender, date_of_birth',
        )
        .eq('id', report.student_id)
        .maybeSingle();
      student = st ?? null;
    }

    const { entries, pdfs } = await this.loadReportEntriesAndPdfsServiceRole(
      reportId,
    );

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

    const entries = rawEntries.map(
      (e: { subject_id: string | null }) => ({
        ...e,
        subject:
          e.subject_id && subjectMap.has(e.subject_id)
            ? subjectMap.get(e.subject_id)
            : null,
      }),
    );

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
    token: string,
  ) {
    const reporting = this.supabaseService.createUserClient(token, 'reporting');

    const { data: entryRows, error: entriesError } = await reporting
      .from('report_book_entry')
      .select('*')
      .eq('report_book_id', reportBookId)
      .order('sort_order', { ascending: true });

    if (entriesError) {
      this.logger.error(`loadReportEntriesAndPdfs entries: ${entriesError.message}`);
      throw new BadRequestException(entriesError.message);
    }

    const rawEntries = entryRows ?? [];
    const subjectIds = rawEntries
      .map((e: { subject_id: string | null }) => e.subject_id)
      .filter((id): id is string => Boolean(id));
    const subjectMap = await this.fetchSubjectsByIdsForUser(token, subjectIds);

    const entries = rawEntries.map(
      (e: { subject_id: string | null }) => ({
        ...e,
        subject:
          e.subject_id && subjectMap.has(e.subject_id)
            ? subjectMap.get(e.subject_id)
            : null,
      }),
    );

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

  private async upsertReportBookNaturalKey(
    serviceClient: ReturnType<SupabaseService['getServiceClient']>,
    row: {
      student_id: string;
      academic_year_id: string;
      term_id: string;
      student_group_id: string;
      report_type: string;
      status: string;
      overall_average: number | null;
      position: number;
      total_students: number;
    },
  ): Promise<string> {
    const { data: existing, error: findErr } = await serviceClient
      .schema('reporting')
      .from('report_book')
      .select('id')
      .eq('student_id', row.student_id)
      .eq('term_id', row.term_id)
      .eq('report_type', row.report_type)
      .maybeSingle();

    if (findErr) {
      throw new BadRequestException(findErr.message);
    }

    if (existing?.id) {
      const { data: updated, error } = await serviceClient
        .schema('reporting')
        .from('report_book')
        .update({
          academic_year_id: row.academic_year_id,
          student_group_id: row.student_group_id,
          status: row.status,
          overall_average: row.overall_average,
          position: row.position,
          total_students: row.total_students,
        })
        .eq('id', existing.id)
        .select('id')
        .single();

      if (error) {
        throw new BadRequestException(error.message);
      }
      const id = updated?.id as string | undefined;
      if (!id) {
        throw new BadRequestException('Failed to update report book');
      }
      return id;
    }

    const { data: inserted, error } = await serviceClient
      .schema('reporting')
      .from('report_book')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    const id = inserted?.id as string | undefined;
    if (!id) {
      throw new BadRequestException('Failed to create report book');
    }
    return id;
  }

  /** Insert or update grade columns by (report_book_id, subject_id). */
  private async upsertReportEntryNaturalKey(
    serviceClient: ReturnType<SupabaseService['getServiceClient']>,
    reportBookId: string,
    fields: {
      subject_id: string;
      coursework_average: number | null;
      exam_average: number | null;
      term_composite: number | null;
      year_grade: number | null;
      sort_order: number;
    },
  ): Promise<void> {
    const { data: existing, error: findErr } = await serviceClient
      .schema('reporting')
      .from('report_book_entry')
      .select('id')
      .eq('report_book_id', reportBookId)
      .eq('subject_id', fields.subject_id)
      .maybeSingle();

    if (findErr) {
      throw new BadRequestException(findErr.message);
    }

    if (existing?.id) {
      const { error } = await serviceClient
        .schema('reporting')
        .from('report_book_entry')
        .update({
          coursework_average: fields.coursework_average,
          exam_average: fields.exam_average,
          term_composite: fields.term_composite,
          year_grade: fields.year_grade,
          sort_order: fields.sort_order,
        })
        .eq('id', existing.id);

      if (error) {
        throw new BadRequestException(error.message);
      }
      return;
    }

    const { error } = await serviceClient
      .schema('reporting')
      .from('report_book_entry')
      .insert({
        report_book_id: reportBookId,
        subject_id: fields.subject_id,
        coursework_average: fields.coursework_average,
        exam_average: fields.exam_average,
        term_composite: fields.term_composite,
        year_grade: fields.year_grade,
        sort_order: fields.sort_order,
      });

    if (error) {
      throw new BadRequestException(error.message);
    }
  }

  /** PostgREST embeds need FK metadata; we query `student.student` explicitly. */
  private async fetchStudentsByIdsForUser(
    token: string,
    ids: string[],
    columns: string,
  ): Promise<Map<string, Record<string, unknown>>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();

    const client = this.supabaseService.createUserClient(token, 'student');
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
      m.set(row.id, row as unknown as Record<string, unknown>);
    }
    return m;
  }

  private async fetchSubjectsByIdsForUser(
    token: string,
    ids: string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();

    const client = this.supabaseService.createUserClient(token, 'public');
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
      m.set(row.id, row as unknown as Record<string, unknown>);
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
      m.set(row.id, row as unknown as Record<string, unknown>);
    }
    return m;
  }

  private async fetchUserProfilesByIdsForUser(
    token: string,
    ids: string[],
  ): Promise<Map<string, { id: string; first_name: string; last_name: string }>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();

    const client = this.supabaseService.createUserClient(token, 'public');
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