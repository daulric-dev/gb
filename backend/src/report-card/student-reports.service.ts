import { Injectable, NotFoundException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { FeatureService } from '@/features/feature.service';
import { ReportDataService, dateOnly } from './report-data.service';
import { renderTranscript } from './report-pdf';
import { assertKeyInSchool } from './report-keys';
import { reportFileName } from './report-card.calc';
import { signReportLink, verifyReportLink } from './report-link';

export interface PublishedReport {
  /** The report_document id: what download and link routes take. */
  id: string;
  termId: string;
  termName: string;
  yearName: string | null;
  startDate: string | null;
  endDate: string | null;
  publishedAt: string;
  /** `ready` can be downloaded; `pending` is still being generated. */
  status: 'pending' | 'ready' | 'failed';
}

export interface ReportFile {
  body: Readable;
  size: number | null;
  filename: string;
}

/**
 * What a student may see of their reports: published terms only, their own
 * documents only. Built to be called by the student portal now and by the
 * parent portal later - every method takes the student id the caller has
 * already resolved and authorised (StudentGuard's `req.student.studentId`,
 * or a parent's linked child), never a client-supplied one unchecked.
 */
@Injectable()
export class StudentReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly data: ReportDataService,
    private readonly features: FeatureService,
  ) {}

  private async schoolOfStudent(studentId: string): Promise<string> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { school_id: true },
    });
    if (!student?.school_id) throw new NotFoundException('Student not found');
    return student.school_id;
  }

  /** Published release per term id, for the student's school. */
  private async publishedTerms(schoolId: string): Promise<Map<string, Date>> {
    const releases = await this.prisma.report_release.findMany({
      where: { school_id: schoolId, published_at: { not: null } },
      select: { term_id: true, published_at: true },
    });
    return new Map(releases.map((r) => [r.term_id, r.published_at!]));
  }

  /** The student's reports for every published term, newest first. */
  async publishedReportsFor(studentId: string): Promise<PublishedReport[]> {
    const schoolId = await this.schoolOfStudent(studentId);
    const published = await this.publishedTerms(schoolId);
    if (published.size === 0) return [];

    const docs = await this.prisma.report_document.findMany({
      where: { student_id: studentId, school_id: schoolId, term_id: { in: [...published.keys()] } },
      select: {
        id: true,
        term_id: true,
        status: true,
        term: {
          select: {
            name: true,
            start_date: true,
            end_date: true,
            academic_year: { select: { name: true } },
          },
        },
      },
    });

    return docs
      .map((d) => ({
        id: d.id,
        termId: d.term_id,
        termName: d.term.name ?? 'Term',
        yearName: d.term.academic_year?.name ?? null,
        startDate: dateOnly(d.term.start_date),
        endDate: dateOnly(d.term.end_date),
        publishedAt: published.get(d.term_id)!.toISOString(),
        status: d.status,
      }))
      .sort(
        (a, b) =>
          (b.startDate ?? '').localeCompare(a.startDate ?? '') ||
          b.publishedAt.localeCompare(a.publishedAt),
      );
  }

  /**
   * The document if it is the student's, in a published term, generated,
   * and stored inside the school's prefix; 404 otherwise.
   */
  private async downloadable(studentId: string | null, documentId: string, schoolId?: string) {
    const doc = await this.prisma.report_document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        school_id: true,
        term_id: true,
        student_id: true,
        status: true,
        storage_key: true,
        term: { select: { name: true } },
        student: { select: { first_name: true, last_name: true } },
      },
    });
    if (!doc || (studentId !== null && doc.student_id !== studentId) || (schoolId && doc.school_id !== schoolId)) {
      throw new NotFoundException('Report not found');
    }
    const release = await this.prisma.report_release.findUnique({
      where: { school_id_term_id: { school_id: doc.school_id, term_id: doc.term_id } },
      select: { published_at: true },
    });
    if (!release?.published_at) throw new NotFoundException('Report not found');
    if (doc.status !== 'ready' || !doc.storage_key) {
      throw new NotFoundException('This report is still being prepared. Try again in a few minutes.');
    }
    assertKeyInSchool(doc.storage_key, doc.school_id);
    return doc;
  }

  private async read(doc: Awaited<ReturnType<StudentReportsService['downloadable']>>): Promise<ReportFile> {
    const object = await this.storage.get(doc.storage_key!);
    if (!object) throw new NotFoundException('This report is still being prepared. Try again in a few minutes.');
    return {
      body: object.body,
      size: object.size ?? null,
      filename: reportFileName(doc.student, doc.term.name ?? 'Term'),
    };
  }

  /** Stream one of the student's published reports. */
  async openReport(studentId: string, documentId: string): Promise<ReportFile> {
    return this.read(await this.downloadable(studentId, documentId));
  }

  /**
   * A signed link to one of the student's published reports, valid for five
   * minutes, for clients that cannot send the session (see report-link.ts).
   * The path is relative to the API origin.
   */
  async createDownloadLink(studentId: string, documentId: string) {
    const doc = await this.downloadable(studentId, documentId);
    const { token, expiresAt } = signReportLink(doc.id, doc.school_id);
    return { url: `/api/report-cards/files/${token}`, expiresAt: expiresAt.toISOString() };
  }

  /** The PDF behind a signed link; 404 for an invalid or expired one. */
  async openSignedLink(token: string): Promise<ReportFile> {
    const claims = verifyReportLink(token);
    if (!claims) throw new NotFoundException('This link has expired. Open the report again.');
    await this.features.assertEnabled(claims.s, 'report_cards');
    return this.read(await this.downloadable(null, claims.d, claims.s));
  }

  /** The student's transcript over published terms only. */
  async transcriptFor(studentId: string) {
    const schoolId = await this.schoolOfStudent(studentId);
    const published = await this.publishedTerms(schoolId);
    return this.data.transcript(schoolId, studentId, new Set(published.keys()));
  }

  async transcriptPdfFor(studentId: string) {
    const doc = await this.transcriptFor(studentId);
    return { bytes: await renderTranscript(doc), filename: transcriptFileName(doc.student.name) };
  }
}

export function transcriptFileName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${cleaned || 'student'}-transcript.pdf`;
}
