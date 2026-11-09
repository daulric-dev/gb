import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ZipArchive } from 'archiver';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { userSchoolId } from '@/common/user-school';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { ReportDataService, type TermContext, dateOnly } from './report-data.service';
import { ReportGenerationService } from './report-generation.service';
import { renderReportCard, renderTranscript } from './report-pdf';
import { assertKeyInSchool } from './report-keys';
import { commentCompletion, reportFileName } from './report-card.calc';
import { transcriptFileName } from './student-reports.service';
import type {
  SaveHeadCommentsDto,
  UpdateReportReleaseDto,
} from './dto/report-card.dto';

/**
 * The school side of report cards: per-term completion, head comments,
 * previews, publishing and downloads. Every method works in the caller's
 * active school (the controller has already checked `report-card:*` there)
 * and 404s a term or student from another school.
 */
@Injectable()
export class ReportReleaseService {
  private readonly logger = new Logger(ReportReleaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly data: ReportDataService,
    private readonly generation: ReportGenerationService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async schoolOf(userId: string): Promise<string> {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) throw new ForbiddenException('You are not assigned to a school');
    return schoolId;
  }

  private release(schoolId: string, termId: string) {
    return this.prisma.report_release.findUnique({
      where: { school_id_term_id: { school_id: schoolId, term_id: termId } },
      select: {
        comment_deadline: true,
        published_at: true,
        published_by: true,
        user_profile: { select: { first_name: true, last_name: true } },
      },
    });
  }

  private releaseOut(r: Awaited<ReturnType<ReportReleaseService['release']>>) {
    return {
      commentDeadline: r?.comment_deadline?.toISOString() ?? null,
      publishedAt: r?.published_at?.toISOString() ?? null,
      publishedBy: r?.published_at
        ? [r.user_profile?.first_name, r.user_profile?.last_name].filter(Boolean).join(' ') || null
        : null,
    };
  }

  private termOut(t: TermContext) {
    return {
      id: t.id,
      name: t.name,
      yearName: t.yearName,
      startDate: dateOnly(t.start_date),
      endDate: dateOnly(t.end_date),
    };
  }

  /** Every term of the school with its release state. */
  async terms(userId: string) {
    const schoolId = await this.schoolOf(userId);
    const [terms, releases] = await Promise.all([
      this.data.terms(schoolId),
      this.prisma.report_release.findMany({
        where: { school_id: schoolId },
        select: { term_id: true, comment_deadline: true, published_at: true },
      }),
    ]);
    const byTerm = new Map(releases.map((r) => [r.term_id, r]));
    return terms.map((t) => ({
      ...this.termOut(t),
      commentDeadline: byTerm.get(t.id)?.comment_deadline?.toISOString() ?? null,
      publishedAt: byTerm.get(t.id)?.published_at?.toISOString() ?? null,
    }));
  }

  /** Completion per course, document progress and the release state. */
  async overview(userId: string, termId: string) {
    const schoolId = await this.schoolOf(userId);
    const term = await this.data.term(schoolId, termId);
    const courses = await this.data.coursesForTerm(term);
    const enrolled = await this.data.enrolments(courses.map((c) => c.id));
    const [comments, release, docs] = await Promise.all([
      courses.length
        ? this.prisma.report_comment.findMany({
            where: { term_id: termId, course_id: { in: courses.map((c) => c.id) } },
            select: { course_id: true, student_id: true, status: true, body: true },
          })
        : Promise.resolve([] as { course_id: string; student_id: string; status: string; body: string }[]),
      this.release(schoolId, termId),
      this.prisma.report_document.groupBy({
        by: ['status'],
        where: { school_id: schoolId, term_id: termId },
        _count: { _all: true },
      }),
    ]);

    const courseRows = courses.map((c) => {
      const ids = enrolled.get(c.id) ?? [];
      const completion = commentCompletion(
        ids,
        comments.filter((x) => x.course_id === c.id),
      );
      return {
        courseId: c.id,
        name: c.name,
        code: c.code,
        teachers: c.teachers,
        yearLong: c.mode === 'year',
        ...completion,
      };
    });
    const students = new Set<string>();
    for (const ids of enrolled.values()) for (const id of ids) students.add(id);

    const documents = { pending: 0, ready: 0, failed: 0 };
    for (const d of docs as { status: keyof typeof documents; _count: { _all: number } }[]) {
      documents[d.status] = d._count._all;
    }

    return {
      term: this.termOut(term),
      ...this.releaseOut(release),
      students: students.size,
      courses: courseRows,
      totals: courseRows.reduce(
        (t, c) => ({
          comments: t.comments + c.students,
          ready: t.ready + c.ready,
          draft: t.draft + c.draft,
          missing: t.missing + c.missing,
        }),
        { comments: 0, ready: 0, draft: 0, missing: 0 },
      ),
      documents,
      generationMode: this.generation.mode,
    };
  }

  /** Set or clear the comment deadline. */
  async update(userId: string, termId: string, dto: UpdateReportReleaseDto) {
    const schoolId = await this.schoolOf(userId);
    await this.data.term(schoolId, termId);
    const deadline = dto.commentDeadline ? new Date(dto.commentDeadline) : null;
    await this.prisma.report_release.upsert({
      where: { school_id_term_id: { school_id: schoolId, term_id: termId } },
      create: { school_id: schoolId, term_id: termId, comment_deadline: deadline },
      update: { comment_deadline: deadline, updated_at: new Date() },
    });
    return this.overview(userId, termId);
  }

  /** Students on the term's reports, with their head comment and PDF state. */
  async students(userId: string, termId: string) {
    const schoolId = await this.schoolOf(userId);
    const term = await this.data.term(schoolId, termId);
    const courses = await this.data.coursesForTerm(term);
    const enrolled = await this.data.enrolments(courses.map((c) => c.id));
    const ids = new Set<string>();
    const courseCount = new Map<string, number>();
    for (const list of enrolled.values()) {
      for (const id of list) {
        ids.add(id);
        courseCount.set(id, (courseCount.get(id) ?? 0) + 1);
      }
    }
    const [students, heads, docs] = await Promise.all([
      this.data.students(schoolId, [...ids]),
      this.prisma.report_head_comment.findMany({
        where: { term_id: termId, student_id: { in: [...ids] } },
        select: { student_id: true, body: true, updated_at: true },
      }),
      this.prisma.report_document.findMany({
        where: { school_id: schoolId, term_id: termId },
        select: { id: true, student_id: true, status: true, error: true, generated_at: true },
      }),
    ]);
    const headOf = new Map(heads.map((h) => [h.student_id, h]));
    const docOf = new Map(docs.map((d) => [d.student_id, d]));
    return students.map((s) => {
      const doc = docOf.get(s.id);
      return {
        studentId: s.id,
        firstName: s.first_name,
        lastName: s.last_name,
        courses: courseCount.get(s.id) ?? 0,
        headComment: headOf.get(s.id)?.body ?? '',
        document: doc
          ? {
              id: doc.id,
              status: doc.status,
              error: doc.error,
              generatedAt: doc.generated_at?.toISOString() ?? null,
            }
          : null,
      };
    });
  }

  private async assertStudentsOnTerm(term: TermContext, studentIds: string[]) {
    const onTerm = new Set(await this.data.studentIdsForTerm(term));
    if (studentIds.some((id) => !onTerm.has(id))) {
      throw new BadRequestException('Some students are not on this term’s reports');
    }
  }

  /** Save head / form tutor comments. Refused while published. */
  async saveHeadComments(userId: string, termId: string, dto: SaveHeadCommentsDto) {
    const schoolId = await this.schoolOf(userId);
    const term = await this.data.term(schoolId, termId);
    const release = await this.release(schoolId, termId);
    if (release?.published_at) {
      throw new ConflictException('Unpublish the reports before changing comments.');
    }
    const ids = dto.comments.map((c) => c.studentId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each student can appear only once');
    await this.assertStudentsOnTerm(term, ids);

    const now = new Date();
    await this.prisma.$transaction(
      dto.comments.map((c) =>
        this.prisma.report_head_comment.upsert({
          where: { term_id_student_id: { term_id: termId, student_id: c.studentId } },
          create: { term_id: termId, student_id: c.studentId, author_id: userId, body: c.body.trim() },
          update: { body: c.body.trim(), author_id: userId, updated_at: now },
        }),
      ),
    );
    return this.students(userId, termId);
  }

  /** One student's report drawn now, marked as a preview unless published. */
  async preview(userId: string, termId: string, studentId: string) {
    const schoolId = await this.schoolOf(userId);
    const term = await this.data.term(schoolId, termId);
    await this.assertStudentsOnTerm(term, [studentId]);
    const release = await this.release(schoolId, termId);
    const doc = await this.data.reportCard(term, studentId, {
      issuedAt: release?.published_at ?? new Date(),
      preview: !release?.published_at,
    });
    const [student] = await this.data.students(schoolId, [studentId]);
    return { bytes: await renderReportCard(doc), filename: reportFileName(student, term.name) };
  }

  private async setPublished(userId: string, termId: string, publish: boolean) {
    const schoolId = await this.schoolOf(userId);
    await this.data.term(schoolId, termId);
    const now = new Date();
    const before = await this.release(schoolId, termId);
    if (publish && before?.published_at) throw new ConflictException('These reports are already published');
    if (!publish && !before?.published_at) throw new ConflictException('These reports are not published');

    const after = await this.prisma.$transaction(async (tx) => {
      const row = await tx.report_release.upsert({
        where: { school_id_term_id: { school_id: schoolId, term_id: termId } },
        create: {
          school_id: schoolId,
          term_id: termId,
          published_at: publish ? now : null,
          published_by: publish ? userId : null,
        },
        update: {
          published_at: publish ? now : null,
          published_by: publish ? userId : null,
          updated_at: now,
        },
        select: { id: true, published_at: true },
      });
      await this.auditLog?.record(tx, schoolId, { id: userId }, {
        entity: 'report_release',
        entityId: row.id,
        action: 'update',
        changes: auditChanges(
          { term_id: termId, published_at: before?.published_at ?? null },
          { term_id: termId, published_at: row.published_at },
        ),
      });
      return row;
    });
    return { schoolId, publishedAt: after.published_at };
  }

  /**
   * Publish: students can see the term's reports from now, and every
   * student's PDF is generated in the background.
   */
  async publish(userId: string, termId: string) {
    const { schoolId, publishedAt } = await this.setPublished(userId, termId, true);
    const { queued } = await this.generation.enqueueTerm(schoolId, termId, publishedAt!);
    return { ...(await this.overview(userId, termId)), queued };
  }

  /** Unpublish: hidden from students again; comments can change. PDFs are regenerated on the next publish. */
  async unpublish(userId: string, termId: string) {
    await this.setPublished(userId, termId, false);
    return this.overview(userId, termId);
  }

  /** Generate the published term's PDFs again (all, or only the failed ones). */
  async regenerate(userId: string, termId: string, failedOnly = false) {
    const schoolId = await this.schoolOf(userId);
    await this.data.term(schoolId, termId);
    const release = await this.release(schoolId, termId);
    if (!release?.published_at) throw new ConflictException('Publish the reports first');
    let only: string[] | undefined;
    if (failedOnly) {
      const failed = await this.prisma.report_document.findMany({
        where: { school_id: schoolId, term_id: termId, status: 'failed' },
        select: { student_id: true },
      });
      only = failed.map((f) => f.student_id);
    }
    const { queued } = await this.generation.enqueueTerm(schoolId, termId, new Date(), only);
    return { ...(await this.overview(userId, termId)), queued };
  }

  /** One student's stored PDF (staff may fetch it whether or not published). */
  async file(userId: string, termId: string, studentId: string) {
    const schoolId = await this.schoolOf(userId);
    const term = await this.data.term(schoolId, termId);
    const doc = await this.prisma.report_document.findFirst({
      where: { school_id: schoolId, term_id: termId, student_id: studentId, status: 'ready' },
      select: { storage_key: true, student: { select: { first_name: true, last_name: true } } },
    });
    if (!doc?.storage_key) throw new NotFoundException('This report has not been generated yet');
    const object = await this.storage.get(assertKeyInSchool(doc.storage_key, schoolId));
    if (!object) throw new NotFoundException('This report has not been generated yet');
    return { body: object.body, size: object.size ?? null, filename: reportFileName(doc.student, term.name) };
  }

  /**
   * Every generated PDF of the term, or of one course's students (a class),
   * as one zip. Students whose PDF is not ready yet are listed in
   * `missing.txt` inside the archive instead of failing the download.
   */
  async zip(userId: string, termId: string, courseId?: string) {
    const schoolId = await this.schoolOf(userId);
    const term = await this.data.term(schoolId, termId);
    let studentIds: string[];
    let label = 'all';
    if (courseId) {
      const [course] = await this.data.coursesForTerm(term, [courseId]);
      if (!course) throw new NotFoundException('Course not found on this term');
      studentIds = (await this.data.enrolments([course.id])).get(course.id) ?? [];
      label = course.code || course.name;
    } else {
      studentIds = await this.data.studentIdsForTerm(term);
    }
    const students = await this.data.students(schoolId, studentIds);
    const docs = await this.prisma.report_document.findMany({
      where: { school_id: schoolId, term_id: termId, student_id: { in: students.map((s) => s.id) }, status: 'ready' },
      select: { student_id: true, storage_key: true },
    });
    if (docs.length === 0) throw new NotFoundException('No reports have been generated for this term yet');
    const keyOf = new Map(docs.map((d) => [d.student_id, d.storage_key]));

    const archive = new ZipArchive({ zlib: { level: 5 } });
    const used = new Set<string>();
    const missing: string[] = [];
    for (const s of students) {
      const key = keyOf.get(s.id);
      const object = key ? await this.storage.get(assertKeyInSchool(key, schoolId)) : null;
      if (!object) {
        missing.push([s.last_name, s.first_name].filter(Boolean).join(', ') || s.id);
        continue;
      }
      let name = reportFileName(s, term.name);
      for (let n = 2; used.has(name.toLowerCase()); n++) name = name.replace(/(-\d+)?\.pdf$/, `-${n}.pdf`);
      used.add(name.toLowerCase());
      archive.append(object.body, { name });
    }
    if (missing.length) {
      archive.append(`Not generated yet:\n${missing.join('\n')}\n`, { name: 'missing.txt' });
    }
    void archive.finalize().catch((error: Error) => {
      this.logger.error(`Failed to build the report archive: ${error.message}`);
    });
    const archiveName = `${term.name} reports ${label}`
      .replace(/[\\/:*?"<>|\p{Cc}]/gu, '_')
      .slice(0, 150);
    return { archive, filename: `${archiveName}.zip` };
  }

  /** A student's transcript over every term (staff see unpublished terms too). */
  async transcript(userId: string, studentId: string) {
    const schoolId = await this.schoolOf(userId);
    return this.data.transcript(schoolId, studentId);
  }

  async transcriptPdf(userId: string, studentId: string) {
    const doc = await this.transcript(userId, studentId);
    return { bytes: await renderTranscript(doc), filename: transcriptFileName(doc.student.name) };
  }
}
