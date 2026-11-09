import { beforeEach, describe, expect, test } from 'bun:test';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CourseAccessService } from '@/course/access/course-access.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { ReportDataService } from './report-data.service';
import { ReportCommentService, defaultTerm } from './report-comment.service';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const TERM = '22222222-2222-4222-8222-222222222222';
const COURSE = '33333333-3333-4333-8333-333333333333';
const S1 = '44444444-4444-4444-8444-444444444441';
const S2 = '44444444-4444-4444-8444-444444444442';

function course(over: Record<string, unknown> = {}) {
  return {
    id: COURSE,
    school_id: SCHOOL,
    academic_year_id: 'year-1',
    term_id: TERM,
    name: 'Biology',
    code: 'BIO',
    description: null,
    status: 'published',
    join_code: null,
    grade_scale_id: null,
    is_template: false,
    created_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  };
}

describe('ReportCommentService', () => {
  let prisma: MockPrisma;
  let service: ReportCommentService;

  /** The caller's school role and course role. */
  function caller(schoolRole: 'admin' | 'teacher' | 'member' | null, courseRole: 'teacher' | 'ta' | null) {
    prisma.school_management.findFirst.mockResolvedValue(
      schoolRole ? { role: schoolRole, school_management_role: [] } : null,
    );
    prisma.course_staff.findUnique.mockResolvedValue(courseRole ? { role: courseRole } : null);
  }

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.course.findUnique.mockResolvedValue(course());
    prisma.term.findFirst.mockResolvedValue({
      id: TERM,
      name: 'Autumn',
      academic_year_id: 'year-1',
      start_date: new Date('2026-09-01'),
      end_date: new Date('2026-12-15'),
      sort_order: 1,
      academic_year: { name: '2026-27' },
    });
    prisma.course_student.findMany.mockResolvedValue([
      { course_id: COURSE, student_id: S1 },
      { course_id: COURSE, student_id: S2 },
    ]);
    prisma.student.findMany.mockResolvedValue([
      { id: S2, first_name: 'Zed', last_name: 'Young' },
      { id: S1, first_name: 'Amy', last_name: 'Adams' },
    ]);
    const access = new CourseAccessService(createMockCacheService() as any, prisma as any);
    const data = new ReportDataService(prisma as any, {} as any);
    service = new ReportCommentService(prisma as any, access, data);
  });

  test('a teacher of the course sees the table, sorted, with grades and comments', async () => {
    caller('teacher', 'teacher');
    prisma.report_comment.findMany.mockResolvedValue([
      { student_id: S1, body: 'Great', status: 'ready', updated_at: new Date('2026-12-01T00:00:00Z') },
    ]);
    const out = await service.list('teacher-1', COURSE);
    expect(out.term?.id).toBe(TERM);
    expect(out.canEdit).toBe(true);
    expect(out.students.map((s) => s.studentId)).toEqual([S1, S2]);
    expect(out.students[0]).toMatchObject({ comment: 'Great', status: 'ready', percent: null, letter: null });
    expect(out.students[1]).toMatchObject({ comment: '', status: null });
  });

  test('the teacher saves several comments at once, upserted per student', async () => {
    caller('teacher', 'teacher');
    await service.save('teacher-1', COURSE, {
      termId: TERM,
      comments: [
        { studentId: S1, body: '  Great term  ', status: 'ready' },
        { studentId: S2, body: 'Needs effort', status: 'draft' },
      ],
    });
    const calls = prisma.report_comment.upsert.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(2);
    expect(calls[0].where).toEqual({
      term_id_course_id_student_id: { term_id: TERM, course_id: COURSE, student_id: S1 },
    });
    expect(calls[0].create).toMatchObject({ body: 'Great term', status: 'ready', author_id: 'teacher-1' });
  });

  test('a TA can read but not write (403)', async () => {
    caller('member', 'ta');
    const out = await service.list('ta-1', COURSE);
    expect(out.canEdit).toBe(false);
    const err = await expectRejection(
      service.save('ta-1', COURSE, { termId: TERM, comments: [{ studentId: S1, body: 'x', status: 'draft' }] }),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(prisma.report_comment.upsert).not.toHaveBeenCalled();
  });

  test('a teacher of another course gets 404 for this one', async () => {
    caller('teacher', null);
    expect(await expectRejection(service.list('other', COURSE))).toBeInstanceOf(NotFoundException);
    const err = await expectRejection(
      service.save('other', COURSE, { termId: TERM, comments: [{ studentId: S1, body: 'x', status: 'draft' }] }),
    );
    expect(err).toBeInstanceOf(NotFoundException);
    expect(prisma.report_comment.upsert).not.toHaveBeenCalled();
  });

  test('someone outside the school gets 404 even with an old course_staff row', async () => {
    caller(null, 'teacher');
    expect(await expectRejection(service.list('left', COURSE))).toBeInstanceOf(NotFoundException);
  });

  test('a student not enrolled in the course is refused', async () => {
    caller('teacher', 'teacher');
    const err = await expectRejection(
      service.save('teacher-1', COURSE, {
        termId: TERM,
        comments: [{ studentId: '55555555-5555-4555-8555-555555555555', body: 'x', status: 'draft' }],
      }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
  });

  test('ready needs a comment; a student appears once', async () => {
    caller('teacher', 'teacher');
    expect(
      await expectRejection(
        service.save('teacher-1', COURSE, { termId: TERM, comments: [{ studentId: S1, body: '  ', status: 'ready' }] }),
      ),
    ).toBeInstanceOf(BadRequestException);
    expect(
      await expectRejection(
        service.save('teacher-1', COURSE, {
          termId: TERM,
          comments: [
            { studentId: S1, body: 'a', status: 'draft' },
            { studentId: S1, body: 'b', status: 'draft' },
          ],
        }),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('comments are locked while the term is published', async () => {
    caller('teacher', 'teacher');
    prisma.report_release.findUnique.mockResolvedValue({ published_at: new Date(), comment_deadline: null });
    const out = await service.list('teacher-1', COURSE);
    expect(out.canEdit).toBe(false);
    const err = await expectRejection(
      service.save('teacher-1', COURSE, { termId: TERM, comments: [{ studentId: S1, body: 'x', status: 'draft' }] }),
    );
    expect(err).toBeInstanceOf(ConflictException);
  });

  test('a term the course does not report in is 404', async () => {
    caller('teacher', 'teacher');
    const err = await expectRejection(service.list('teacher-1', COURSE, '66666666-6666-4666-8666-666666666666'));
    expect(err).toBeInstanceOf(NotFoundException);
  });
});

describe('defaultTerm', () => {
  const t = (id: string, start: string, end: string) =>
    ({ id, start_date: new Date(start), end_date: new Date(end) }) as any;
  const terms = [t('a', '2026-09-01', '2026-12-15'), t('b', '2027-01-05', '2027-03-30'), t('c', '2027-04-15', '2027-07-15')];

  test('the current term, else the latest started, else the first', () => {
    expect(defaultTerm(terms, new Date('2026-12-15T18:00:00Z'))?.id).toBe('a');
    expect(defaultTerm(terms, new Date('2027-04-01'))?.id).toBe('b');
    expect(defaultTerm(terms, new Date('2026-01-01'))?.id).toBe('a');
    expect(defaultTerm([], new Date())).toBeNull();
  });
});
