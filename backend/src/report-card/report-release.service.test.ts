import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Readable } from 'node:stream';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PDFDocument } from '@pdfme/pdf-lib';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { FeatureService } from '@/features/feature.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { ReportDataService } from './report-data.service';
import { ReportGenerationService } from './report-generation.service';
import { ReportReleaseService } from './report-release.service';
import { StudentReportsService } from './student-reports.service';
import { assertKeyInSchool, reportKey, schoolReportPrefix } from './report-keys';
import { signReportLink, verifyReportLink } from './report-link';
import { reportJobId } from './report-card.constants';
import { pdfText } from '@/test/pdf-text';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const OTHER_SCHOOL = '99999999-9999-4999-8999-999999999999';
const TERM = '22222222-2222-4222-8222-222222222222';
const COURSE = '33333333-3333-4333-8333-333333333333';
const S1 = '44444444-4444-4444-8444-444444444441';
const S2 = '44444444-4444-4444-8444-444444444442';
const DOC = '55555555-5555-4555-8555-555555555555';

/** In-memory storage with streams, like StorageService.get. */
function fakeStorage() {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    failPuts: 0,
    put: mock(async (key: string, body: Buffer, _contentType?: string) => {
      objects.set(key, Buffer.from(body));
    }),
    get: mock(async (key: string) => {
      const b = objects.get(key);
      return b ? { body: Readable.from(b), contentType: 'application/pdf', size: b.length } : null;
    }),
    getBuffer: mock(async (key: string) => objects.get(key) ?? null),
  };
}

/** A school with one term, one course and two enrolled students. */
function seed(prisma: MockPrisma) {
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL, account_type: 'staff' });
  prisma.organisation.findFirst.mockResolvedValue({ features: {} });
  prisma.school.findUnique.mockImplementation(async ({ where }: any) =>
    where.id === SCHOOL ? { name: 'Hillside Academy', logo_path: null, disabled_features: [] } : null,
  );
  prisma.term.findFirst.mockImplementation(async ({ where }: any) =>
    where.id === TERM && where.academic_year.school_id === SCHOOL
      ? {
          id: TERM,
          name: 'Autumn',
          academic_year_id: 'year-1',
          start_date: new Date('2026-09-01'),
          end_date: new Date('2026-12-15'),
          sort_order: 1,
          academic_year: { name: '2026-27' },
        }
      : null,
  );
  prisma.course.findMany.mockResolvedValue([
    {
      id: COURSE,
      name: 'Mathematics',
      code: 'MA1',
      school_id: SCHOOL,
      term_id: TERM,
      academic_year_id: 'year-1',
      grade_scale_id: null,
    },
  ]);
  prisma.course_staff.findMany.mockResolvedValue([
    { course_id: COURSE, user_profile: { first_name: 'Charles', last_name: 'Babbage' } },
  ]);
  prisma.course_student.findMany.mockResolvedValue([
    { course_id: COURSE, student_id: S1 },
    { course_id: COURSE, student_id: S2 },
  ]);
  prisma.student.findMany.mockImplementation(async ({ where }: any) =>
    [
      { id: S1, first_name: 'Ada', last_name: 'Lovelace' },
      { id: S2, first_name: 'Alan', last_name: 'Turing' },
    ].filter((s) => where.id.in.includes(s.id) && where.school_id === SCHOOL),
  );
  prisma.activity.findMany.mockResolvedValue([
    { id: 'a1', assignment_group_id: null, points: 10, status: 'published', omit_from_final_grade: false, due_at: null, created_at: new Date('2026-10-01') },
  ]);
  prisma.submission.findMany.mockResolvedValue([
    { activity_id: 'a1', student_id: S1, status: 'graded', score: 9, excused: false },
  ]);
  prisma.grade_scale.findFirst.mockResolvedValue({ id: 'scale' });
  prisma.grade_scale_band.findMany.mockResolvedValue([
    { label: 'A', min_percentage: 90, max_percentage: 100 },
    { label: 'B', min_percentage: 80, max_percentage: 89 },
  ]);
  prisma.report_comment.findMany.mockResolvedValue([{ course_id: COURSE, body: 'A gifted mathematician.' }]);
  prisma.report_head_comment.findUnique.mockResolvedValue({ body: 'Keep it up.' });
  prisma.course_attendance_record.findMany.mockResolvedValue([
    { status: 'present' },
    { status: 'present' },
    { status: 'late' },
    { status: 'absent' },
  ]);
}

function build() {
  const prisma = createMockPrisma();
  seed(prisma);
  const storage = fakeStorage();
  const features = new FeatureService(prisma as any, createMockCacheService() as any);
  const data = new ReportDataService(prisma as any, storage as any);
  const generation = new ReportGenerationService(prisma as any, storage as any, data, features);
  generation.inlineBackoffMs = 0;
  const audit = { record: mock(async () => undefined) };
  const releases = new ReportReleaseService(prisma as any, storage as any, data, generation, audit as any);
  const students = new StudentReportsService(prisma as any, storage as any, data, features);
  return { prisma, storage, features, data, generation, releases, students, audit };
}

describe('report generation', () => {
  let ctx: ReturnType<typeof build>;
  const published = new Date('2026-12-18T10:00:00Z');

  beforeEach(() => {
    ctx = build();
    ctx.prisma.report_release.findUnique.mockResolvedValue({ published_at: published });
  });

  test('renders the student report into the school-scoped key and records it ready', async () => {
    const outcome = await ctx.generation.generate({ schoolId: SCHOOL, termId: TERM, studentId: S1 });
    expect(outcome).toBe('generated');
    const key = reportKey(SCHOOL, TERM, S1);
    expect(key).toBe(`report-cards/schools/${SCHOOL}/terms/${TERM}/${S1}.pdf`);
    expect(ctx.storage.put.mock.calls[0][0]).toBe(key);
    expect(ctx.storage.put.mock.calls[0][2]).toBe('application/pdf');

    const pdf = ctx.storage.objects.get(key)!;
    await PDFDocument.load(pdf);
    const text = await pdfText(pdf);
    for (const s of ['Hillside Academy', 'Ada Lovelace', 'Mathematics (MA1)', '90%', 'A', 'Charles Babbage', 'A gifted mathematician.', 'Present 2 Late 1 Absent 1', 'Keep it up.']) {
      expect(text).toContain(s);
    }

    const upsert = ctx.prisma.report_document.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ term_id_student_id: { term_id: TERM, student_id: S1 } });
    expect(upsert.update).toMatchObject({ status: 'ready', storage_key: key, error: null });
    // Attendance reads status only: never location data.
    expect(ctx.prisma.course_attendance_record.findMany.mock.calls[0][0].select).toEqual({ status: true });
  });

  test('is idempotent: a re-run overwrites the same object and upserts the same row', async () => {
    await ctx.generation.generate({ schoolId: SCHOOL, termId: TERM, studentId: S1 });
    await ctx.generation.generate({ schoolId: SCHOOL, termId: TERM, studentId: S1 });
    expect(ctx.storage.objects.size).toBe(1);
    const keys = ctx.storage.put.mock.calls.map((c) => c[0]);
    expect(new Set(keys).size).toBe(1);
    expect(ctx.prisma.report_document.upsert).toHaveBeenCalledTimes(2);
    expect(ctx.prisma.report_document.create).not.toHaveBeenCalled();
  });

  test('skips a term that was unpublished meanwhile, and a school with report cards off', async () => {
    ctx.prisma.report_release.findUnique.mockResolvedValue({ published_at: null });
    expect(await ctx.generation.generate({ schoolId: SCHOOL, termId: TERM, studentId: S1 })).toBe('skipped');

    ctx.prisma.report_release.findUnique.mockResolvedValue({ published_at: published });
    ctx.prisma.school.findUnique.mockResolvedValue({ name: 'x', logo_path: null, disabled_features: ['report_cards'] });
    const off = new ReportGenerationService(
      ctx.prisma as any,
      ctx.storage as any,
      ctx.data,
      new FeatureService(ctx.prisma as any, createMockCacheService() as any),
    );
    expect(await off.generate({ schoolId: SCHOOL, termId: TERM, studentId: S1 })).toBe('skipped');
    expect(ctx.storage.put).not.toHaveBeenCalled();
  });

  test('a failure keeps the row pending until the last attempt, then marks it failed', async () => {
    ctx.storage.put.mockImplementation(async () => {
      throw new Error('storage down');
    });
    await expectRejection(ctx.generation.generate({ schoolId: SCHOOL, termId: TERM, studentId: S1 }, { attempt: 1, final: false }));
    // First the attempt is recorded on the row (for the resume sweep), then the failure.
    expect(ctx.prisma.report_document.updateMany.mock.calls[0][0]).toMatchObject({ where: { status: 'pending' }, data: { attempts: 1 } });
    expect(ctx.prisma.report_document.updateMany.mock.calls[1][0].data).toMatchObject({ status: 'pending', attempts: 1, error: 'storage down' });
    await expectRejection(ctx.generation.generate({ schoolId: SCHOOL, termId: TERM, studentId: S1 }, { attempt: 3, final: true }));
    expect(ctx.prisma.report_document.updateMany.mock.calls[3][0].data).toMatchObject({ status: 'failed', attempts: 3 });
  });

  test('inline mode retries a failing job and carries on with the rest', async () => {
    let fails = 1;
    const real = ctx.storage.put.getMockImplementation()!;
    ctx.storage.put.mockImplementation(async (...args: any[]) => {
      if (fails-- > 0) throw new Error('blip');
      return (real as any)(...args);
    });
    const { queued } = await ctx.generation.enqueueTerm(SCHOOL, TERM, published);
    expect(queued).toBe(2);
    await ctx.generation.inflight;
    expect(ctx.storage.objects.size).toBe(2);
    expect(ctx.storage.put).toHaveBeenCalledTimes(3);
    // Rows were created pending first, without duplicates.
    expect(ctx.prisma.report_document.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  test('queue mode adds one job per student with a per-publish job id (deduplicated by BullMQ)', async () => {
    const queue = { addBulk: mock(async () => []) };
    const queued = new ReportGenerationService(ctx.prisma as any, ctx.storage as any, ctx.data, ctx.features, queue as any);
    expect(queued.mode).toBe('queue');
    await queued.enqueueTerm(SCHOOL, TERM, published);
    const jobs = (queue.addBulk.mock.calls[0] as any)[0];
    expect(jobs).toHaveLength(2);
    expect(jobs[0].opts).toMatchObject({ attempts: 3, jobId: reportJobId({ schoolId: SCHOOL, termId: TERM, studentId: S1 }, published) });
    expect(jobs[0].opts.jobId).toBe(`report-${TERM}-${S1}-${published.getTime()}`);
    expect(ctx.storage.put).not.toHaveBeenCalled();
  });
});

describe('publishing and what students see', () => {
  let ctx: ReturnType<typeof build>;
  let releaseRow: { published_at: Date | null; comment_deadline: Date | null; published_by?: string | null };

  beforeEach(() => {
    ctx = build();
    releaseRow = { published_at: null, comment_deadline: null };
    ctx.prisma.report_release.findUnique.mockImplementation(async () => ({ ...releaseRow, user_profile: null }));
    ctx.prisma.report_release.upsert.mockImplementation(async ({ update }: any) => {
      releaseRow = { ...releaseRow, ...update };
      return { id: 'rel-1', published_at: releaseRow.published_at };
    });
    ctx.prisma.report_release.findMany.mockImplementation(async () =>
      releaseRow.published_at ? [{ term_id: TERM, published_at: releaseRow.published_at }] : [],
    );
    ctx.prisma.student.findUnique.mockResolvedValue({ school_id: SCHOOL });
    ctx.prisma.report_document.findMany.mockImplementation(async ({ where }: any) =>
      where.student_id === S1 && where.term_id?.in?.includes(TERM)
        ? [{ id: DOC, term_id: TERM, status: 'ready', term: { name: 'Autumn', start_date: new Date('2026-09-01'), end_date: new Date('2026-12-15'), academic_year: { name: '2026-27' } } }]
        : [],
    );
    ctx.prisma.report_document.findUnique.mockResolvedValue({
      id: DOC,
      school_id: SCHOOL,
      term_id: TERM,
      student_id: S1,
      status: 'ready',
      storage_key: reportKey(SCHOOL, TERM, S1),
      term: { name: 'Autumn' },
      student: { first_name: 'Ada', last_name: 'Lovelace' },
    });
    ctx.storage.objects.set(reportKey(SCHOOL, TERM, S1), Buffer.from('%PDF-1.7 test'));
  });

  test('nothing is visible before publishing', async () => {
    expect(await ctx.students.publishedReportsFor(S1)).toEqual([]);
    expect(await expectRejection(ctx.students.openReport(S1, DOC))).toBeInstanceOf(NotFoundException);
  });

  test('publish makes the report visible, queues generation and is audited; unpublish hides it again', async () => {
    const out = await ctx.releases.publish('admin-1', TERM);
    expect(out.queued).toBe(2);
    expect(releaseRow.published_at).toBeInstanceOf(Date);
    expect(releaseRow.published_by).toBe('admin-1');
    expect(ctx.audit.record).toHaveBeenCalledTimes(1);
    await ctx.generation.inflight;

    const list = await ctx.students.publishedReportsFor(S1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: DOC, termName: 'Autumn', yearName: '2026-27', status: 'ready' });
    const file = await ctx.students.openReport(S1, DOC);
    expect(file.filename).toBe('Lovelace-Ada-Autumn-report.pdf');

    await ctx.releases.unpublish('admin-1', TERM);
    expect(releaseRow.published_at).toBeNull();
    expect(await ctx.students.publishedReportsFor(S1)).toEqual([]);
    expect(await expectRejection(ctx.students.openReport(S1, DOC))).toBeInstanceOf(NotFoundException);
  });

  test('publishing twice or unpublishing an unpublished term is a conflict', async () => {
    expect(await expectRejection(ctx.releases.unpublish('admin-1', TERM))).toBeInstanceOf(ConflictException);
    await ctx.releases.publish('admin-1', TERM);
    expect(await expectRejection(ctx.releases.publish('admin-1', TERM))).toBeInstanceOf(ConflictException);
  });

  test("a student cannot open another student's report", async () => {
    releaseRow.published_at = new Date();
    expect(await expectRejection(ctx.students.openReport(S2, DOC))).toBeInstanceOf(NotFoundException);
    expect(await expectRejection(ctx.students.createDownloadLink(S2, DOC))).toBeInstanceOf(NotFoundException);
  });

  test('a stored key outside the school is refused (403) even for the owner', async () => {
    releaseRow.published_at = new Date();
    ctx.prisma.report_document.findUnique.mockResolvedValue({
      id: DOC,
      school_id: SCHOOL,
      term_id: TERM,
      student_id: S1,
      status: 'ready',
      storage_key: reportKey(OTHER_SCHOOL, TERM, S1),
      term: { name: 'Autumn' },
      student: { first_name: 'Ada', last_name: 'Lovelace' },
    });
    expect(await expectRejection(ctx.students.openReport(S1, DOC))).toBeInstanceOf(ForbiddenException);
  });

  test('a pending report is listed but not downloadable yet', async () => {
    releaseRow.published_at = new Date();
    ctx.prisma.report_document.findUnique.mockResolvedValue({
      id: DOC, school_id: SCHOOL, term_id: TERM, student_id: S1, status: 'pending', storage_key: null,
      term: { name: 'Autumn' }, student: { first_name: 'Ada', last_name: 'Lovelace' },
    });
    expect(await expectRejection(ctx.students.openReport(S1, DOC))).toBeInstanceOf(NotFoundException);
  });

  test('signed links open the published report until they expire, and honour the feature', async () => {
    releaseRow.published_at = new Date();
    const { url, expiresAt } = await ctx.students.createDownloadLink(S1, DOC);
    expect(url.startsWith('/api/report-cards/files/')).toBe(true);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    const token = url.split('/').pop()!;
    const file = await ctx.students.openSignedLink(token);
    expect(file.filename).toBe('Lovelace-Ada-Autumn-report.pdf');

    // Tampered or expired tokens are refused.
    expect(await expectRejection(ctx.students.openSignedLink(token.slice(0, -2) + 'xx'))).toBeInstanceOf(NotFoundException);
    const old = signReportLink(DOC, SCHOOL, Date.now() - 10 * 60_000).token;
    expect(await expectRejection(ctx.students.openSignedLink(old))).toBeInstanceOf(NotFoundException);

    // Unpublished since: refused.
    releaseRow.published_at = null;
    expect(await expectRejection(ctx.students.openSignedLink(token))).toBeInstanceOf(NotFoundException);

    // Feature off for the school: 403 FEATURE_DISABLED.
    releaseRow.published_at = new Date();
    ctx.prisma.school.findUnique.mockResolvedValue({ name: 'x', logo_path: null, disabled_features: ['report_cards'] });
    const fresh = new StudentReportsService(
      ctx.prisma as any,
      ctx.storage as any,
      ctx.data,
      new FeatureService(ctx.prisma as any, createMockCacheService() as any),
    );
    expect(await expectRejection(fresh.openSignedLink(token))).toBeInstanceOf(FeatureDisabledException);
  });

  test('a link for one school cannot open a document of another', async () => {
    releaseRow.published_at = new Date();
    const forged = signReportLink(DOC, OTHER_SCHOOL).token;
    expect(await expectRejection(ctx.students.openSignedLink(forged))).toBeInstanceOf(NotFoundException);
  });

  test("another school's term is 404 for every admin route", async () => {
    const other = '77777777-7777-4777-8777-777777777777';
    for (const call of [
      () => ctx.releases.overview('admin-1', other),
      () => ctx.releases.publish('admin-1', other),
      () => ctx.releases.preview('admin-1', other, S1),
      () => ctx.releases.saveHeadComments('admin-1', other, { comments: [] }),
    ]) {
      expect(await expectRejection(call())).toBeInstanceOf(NotFoundException);
    }
  });

  test('head comments are refused while published and for students not on the term', async () => {
    expect(
      await expectRejection(
        ctx.releases.saveHeadComments('admin-1', TERM, {
          comments: [{ studentId: '88888888-8888-4888-8888-888888888888', body: 'x' }],
        }),
      ),
    ).toMatchObject({ status: 400 });
    releaseRow.published_at = new Date();
    expect(
      await expectRejection(ctx.releases.saveHeadComments('admin-1', TERM, { comments: [{ studentId: S1, body: 'x' }] })),
    ).toBeInstanceOf(ConflictException);
  });

  test('the overview reports completion per course', async () => {
    ctx.prisma.report_comment.findMany.mockResolvedValue([
      { course_id: COURSE, student_id: S1, status: 'ready', body: 'Good' },
    ]);
    const out = await ctx.releases.overview('admin-1', TERM);
    expect(out.courses[0]).toMatchObject({ courseId: COURSE, students: 2, ready: 1, missing: 1, teachers: ['Charles Babbage'] });
    expect(out.totals).toEqual({ comments: 2, ready: 1, draft: 0, missing: 1 });
    expect(out.generationMode).toBe('inline');
  });

  test('a preview is a valid PDF marked as a preview', async () => {
    const { bytes, filename } = await ctx.releases.preview('admin-1', TERM, S1);
    expect(filename).toBe('Lovelace-Ada-Autumn-report.pdf');
    expect(await pdfText(bytes)).toContain('PREVIEW - not yet published');
  });
});

describe('keys and links', () => {
  test('keys are school-scoped and validated', () => {
    expect(schoolReportPrefix(SCHOOL)).toBe(`report-cards/schools/${SCHOOL}/`);
    expect(() => reportKey('../etc', TERM, S1)).toThrow();
    expect(assertKeyInSchool(reportKey(SCHOOL, TERM, S1), SCHOOL)).toBe(reportKey(SCHOOL, TERM, S1));
    expect(() => assertKeyInSchool(reportKey(OTHER_SCHOOL, TERM, S1), SCHOOL)).toThrow(ForbiddenException);
    expect(() => assertKeyInSchool(`report-cards/schools/${SCHOOL}/../x.pdf`, SCHOOL)).toThrow(ForbiddenException);
    expect(() => assertKeyInSchool(null, SCHOOL)).toThrow(ForbiddenException);
  });

  test('link tokens verify, and fail when tampered, malformed or expired', () => {
    const now = Date.now();
    const { token } = signReportLink(DOC, SCHOOL, now);
    expect(verifyReportLink(token, now)).toMatchObject({ d: DOC, s: SCHOOL });
    expect(verifyReportLink(token, now + 6 * 60_000)).toBeNull();
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ d: DOC, s: OTHER_SCHOOL, e: Math.floor(now / 1000) + 300 })).toString('base64url');
    expect(verifyReportLink(`${forged}.${sig}`, now)).toBeNull();
    expect(verifyReportLink(`${payload}`, now)).toBeNull();
    expect(verifyReportLink(`${token}.x`, now)).toBeNull();
    expect(verifyReportLink('', now)).toBeNull();
  });
});
