import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CourseCopyService, relinkIds, shiftDate } from './course-copy.service';
import { CourseService } from './course.service';
import { CourseAccessService } from './access/course-access.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const USER = 'user-1';
const SOURCE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const PAGE = '33333333-3333-4333-8333-333333333333';
const ACT = '44444444-4444-4444-8444-444444444444';

function courseRow(over: Record<string, any> = {}) {
  return {
    id: SOURCE,
    school_id: 'school-1',
    academic_year_id: null,
    term_id: null,
    name: 'Biology',
    code: 'BIO',
    description: 'Cells',
    status: 'published',
    join_code: 'ABC234',
    grade_scale_id: 'scale-1',
    is_template: false,
    created_by: 'someone',
    created_at: new Date('2026-10-01T00:00:00Z'),
    updated_at: new Date('2026-10-01T00:00:00Z'),
    ...over,
  };
}

/** A source course with one of everything, the caller holding `courseRole`. */
function db(opts: {
  schoolRole?: 'admin' | 'teacher' | 'member';
  courseRole?: 'teacher' | 'ta' | null;
  source?: Record<string, any>;
}): MockPrisma {
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
  prisma.school_management.findFirst.mockResolvedValue({
    role: opts.schoolRole ?? 'teacher',
    school_management_role: [],
  });
  prisma.course_staff.findUnique.mockImplementation(async ({ where }: any) =>
    opts.courseRole &&
    where.course_id_user_profile_id.course_id === SOURCE
      ? { role: opts.courseRole }
      : opts.courseRole && where.course_id_user_profile_id.course_id === TARGET
        ? { role: 'teacher' }
        : null,
  );
  prisma.course.findUnique.mockImplementation(async ({ where }: any) =>
    where.id === SOURCE
      ? courseRow(opts.source)
      : courseRow({ id: where.id, is_template: false }),
  );
  prisma.course.create.mockImplementation(async ({ data }: any) =>
    courseRow({ ...data, id: TARGET, status: 'draft', join_code: null }),
  );

  const where = (fn: (courseId: string) => any[]) =>
    async ({ where }: any) => (where.course_id === SOURCE ? fn(SOURCE) : []);

  prisma.assignment_group.findMany.mockImplementation(
    where(() => [
      { id: 'g1', name: 'Labs', weight: 40, position: 0, drop_lowest: 1, drop_highest: 0 },
    ]),
  );
  prisma.assignment_group.aggregate.mockResolvedValue({ _max: { position: null } });
  prisma.module.aggregate.mockResolvedValue({ _max: { position: null } });
  prisma.rubric.findMany.mockImplementation(
    where(() => [
      {
        id: 'r1',
        title: 'Lab rubric',
        rubric_criterion: [
          {
            id: 'c1',
            title: 'Method',
            description: null,
            points: 4,
            position: 0,
            rubric_rating: [
              { id: 'x1', label: 'Good', description: null, points: 4, position: 0 },
            ],
          },
        ],
      },
    ]),
  );
  prisma.activity.findMany.mockImplementation(
    where(() => [
      {
        id: ACT,
        kind: 'quiz',
        title: 'Quiz 1',
        instructions: `See /courses/${SOURCE}/pages/${PAGE}`,
        points: 10,
        due_at: new Date('2026-01-10T15:00:00Z'),
        status: 'published',
        published_at: new Date('2026-01-01T00:00:00Z'),
        allow_file: false,
        allow_text: false,
        max_attempts: 2,
        assignment_group_id: 'g1',
        omit_from_final_grade: false,
        rubric_id: 'r1',
        quiz_question: [
          {
            id: 'q1',
            prompt: '2+2?',
            kind: 'single',
            points: 1,
            sort_order: 0,
            quiz_option: [
              { id: 'o1', label: '4', is_correct: true, sort_order: 0 },
            ],
          },
        ],
      },
    ]),
  );
  prisma.page.findMany.mockImplementation(
    where(() => [{ id: PAGE, title: 'Intro', body: 'Hi', is_published: true }]),
  );
  prisma.module.findMany.mockImplementation(
    where(() => [{ id: 'm1', title: 'Week 1', position: 0, is_published: true }]),
  );
  prisma.module_item.findMany.mockImplementation(
    where(() => [
      { module_id: 'm1', position: 0, item_type: 'page', title: null, page_id: PAGE, activity_id: null, file_id: null, url: null, indent: 0, is_published: true },
      { module_id: 'm1', position: 1, item_type: 'activity', title: null, page_id: null, activity_id: ACT, file_id: null, url: null, indent: 0, is_published: true },
      { module_id: 'm1', position: 2, item_type: 'file', title: 'Notes', page_id: null, activity_id: null, file_id: 'f1', url: null, indent: 1, is_published: true },
      { module_id: 'm1', position: 3, item_type: 'discussion', title: null, page_id: null, activity_id: null, file_id: null, discussion_topic_id: 'tp1', url: null, indent: 0, is_published: true },
      // Points at a topic a student started, which is not copied.
      { module_id: 'm1', position: 4, item_type: 'discussion', title: null, page_id: null, activity_id: null, file_id: null, discussion_topic_id: 'tp2', url: null, indent: 0, is_published: true },
    ]),
  );
  prisma.discussion_topic.findMany.mockImplementation(
    where(() => [
      { id: 'tp1', title: 'Welcome', body: '', is_pinned: true, is_locked: false, require_initial_post: true, is_published: true, user_profile: { account_type: 'staff' } },
      { id: 'tp2', title: 'Help?', body: '', is_pinned: false, is_locked: false, require_initial_post: false, is_published: true, user_profile: { account_type: 'student' } },
    ]),
  );
  return prisma;
}

function service(prisma: MockPrisma) {
  const cache = createMockCacheService() as any;
  const access = new CourseAccessService(cache, prisma as any);
  return new CourseCopyService(
    cache,
    access,
    new CourseService(cache, access, prisma as any),
    prisma as any,
  );
}

const rows = (prisma: MockPrisma, model: string) =>
  prisma[model].createMany.mock.calls.flatMap((c: any[]) => c[0].data);

describe('CourseCopyService.copy', () => {
  test('makes a draft course taught by the copier, with the design but no class', async () => {
    const prisma = db({ courseRole: 'teacher' });
    const result = await service(prisma).copy(USER, SOURCE, {
      name: ' Biology 2027 ',
      shiftDays: 7,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.course.create.mock.calls[0][0].data).toMatchObject({
      name: 'Biology 2027',
      description: 'Cells',
      grade_scale_id: 'scale-1',
      created_by: USER,
    });
    expect(prisma.course.create.mock.calls[0][0].data.join_code).toBeUndefined();
    expect(prisma.course_staff.create.mock.calls[0][0].data).toEqual({
      course_id: TARGET,
      user_profile_id: USER,
      role: 'teacher',
    });
    expect(result.studentCount).toBe(0);
    expect(result.copied).toEqual({
      assignmentGroups: 1,
      rubrics: 1,
      activities: 1,
      quizQuestions: 1,
      pages: 1,
      modules: 1,
      moduleItems: 4,
      discussionTopics: 1,
    });
    expect(prisma.course_student.createMany).not.toHaveBeenCalled();
    expect(prisma.submission.createMany).not.toHaveBeenCalled();
  });

  test('repoints every reference at the copies and shifts due dates', async () => {
    const prisma = db({ courseRole: 'teacher' });
    await service(prisma).copy(USER, SOURCE, { name: 'Copy', shiftDays: 7 });

    const [group] = rows(prisma, 'assignment_group');
    const [rubric] = rows(prisma, 'rubric');
    const [activity] = rows(prisma, 'activity');
    const [page] = rows(prisma, 'page');
    const [module] = rows(prisma, 'module');
    const items = rows(prisma, 'module_item');

    expect(group).toMatchObject({ course_id: TARGET, weight: 40, drop_lowest: 1 });
    expect(group.id).not.toBe('g1');
    expect(activity).toMatchObject({
      course_id: TARGET,
      status: 'draft',
      published_at: null,
      assignment_group_id: group.id,
      rubric_id: rubric.id,
      max_attempts: 2,
    });
    expect(activity.id).not.toBe(ACT);
    expect(activity.due_at).toEqual(new Date('2026-01-17T15:00:00Z'));
    expect(activity.instructions).toBe(`See /courses/${TARGET}/pages/${page.id}`);
    expect(rows(prisma, 'quiz_question')[0].activity_id).toBe(activity.id);
    expect(rows(prisma, 'quiz_option')[0]).toMatchObject({ label: '4', is_correct: true });
    expect(rows(prisma, 'rubric_rating')[0].criterion_id).toBe(
      rows(prisma, 'rubric_criterion')[0].id,
    );

    expect(items.map((i: any) => i.module_id)).toEqual([
      module.id,
      module.id,
      module.id,
      module.id,
    ]);
    expect(items[0].page_id).toBe(page.id);
    expect(items[1].activity_id).toBe(activity.id);
    // A file item keeps the same file the source course offered.
    expect(items[2].file_id).toBe('f1');

    const topics = rows(prisma, 'discussion_topic');
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({
      title: 'Welcome',
      is_published: false,
      author_user_profile_id: USER,
    });
    // The discussion item follows its topic; the student topic's item is left.
    expect(topics[0].id).not.toBe('tp1');
    expect(items[3]).toMatchObject({
      item_type: 'discussion',
      discussion_topic_id: topics[0].id,
    });
    expect(items[0].discussion_topic_id).toBeNull();
  });

  test('clearing due dates copies activities without one', async () => {
    const prisma = db({ courseRole: 'teacher' });
    await service(prisma).copy(USER, SOURCE, { name: 'Copy', clearDueDates: true });
    expect(rows(prisma, 'activity')[0].due_at).toBeNull();
  });

  test('start dates shift by the whole days between them', async () => {
    const prisma = db({ courseRole: 'teacher' });
    await service(prisma).copy(USER, SOURCE, {
      name: 'Copy',
      sourceStartDate: '2026-01-05',
      targetStartDate: '2027-01-04',
    });
    expect(rows(prisma, 'activity')[0].due_at).toEqual(
      new Date('2027-01-09T15:00:00Z'),
    );
  });

  test('two ways of moving dates at once are refused', async () => {
    const prisma = db({ courseRole: 'teacher' });
    const err = await expectRejection(
      service(prisma).copy(USER, SOURCE, {
        name: 'Copy',
        shiftDays: 3,
        clearDueDates: true,
      }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('a TA cannot copy the course', async () => {
    const prisma = db({ courseRole: 'ta' });
    const err = await expectRejection(
      service(prisma).copy(USER, SOURCE, { name: 'Copy' }),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  test('a course the caller has no part in is not found', async () => {
    const prisma = db({ courseRole: null });
    const err = await expectRejection(
      service(prisma).copy(USER, SOURCE, { name: 'Copy' }),
    );
    expect(err).toBeInstanceOf(NotFoundException);
  });

  test('a school template can be copied by any teacher in the school', async () => {
    const prisma = db({ courseRole: null, source: { is_template: true } });
    const result = await service(prisma).copy(USER, SOURCE, { name: 'Copy' });
    expect(result.role).toBe('teacher');
    expect(result.isTemplate).toBe(false);
  });

  test('a member without course:create cannot copy a template', async () => {
    const prisma = db({
      schoolRole: 'member',
      courseRole: null,
      source: { is_template: true },
    });
    const err = await expectRejection(
      service(prisma).copy(USER, SOURCE, { name: 'Copy' }),
    );
    expect(err).toBeInstanceOf(NotFoundException);
  });
});

describe('CourseCopyService.importInto', () => {
  test('merges assignment groups by name and appends modules', async () => {
    const prisma = db({ courseRole: 'teacher' });
    prisma.assignment_group.findMany.mockImplementation(async ({ where }: any) =>
      where.course_id === SOURCE
        ? [{ id: 'g1', name: 'Labs', weight: 40, position: 0, drop_lowest: 0, drop_highest: 0 }]
        : [{ id: 'existing', name: 'labs' }],
    );
    prisma.module.aggregate.mockResolvedValue({ _max: { position: 4 } });

    const { copied } = await service(prisma).importInto(USER, TARGET, {
      sourceCourseId: SOURCE,
    });

    expect(copied.assignmentGroups).toBe(0);
    expect(rows(prisma, 'activity')[0].assignment_group_id).toBe('existing');
    expect(rows(prisma, 'module')[0].position).toBe(5);
    expect(prisma.course.create).not.toHaveBeenCalled();
  });

  test('a course cannot import from itself', async () => {
    const prisma = db({ courseRole: 'teacher' });
    const err = await expectRejection(
      service(prisma).importInto(USER, SOURCE, { sourceCourseId: SOURCE }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
  });
});

describe('helpers', () => {
  test('shiftDate keeps, moves or clears', () => {
    const d = new Date('2026-03-01T09:00:00Z');
    expect(shiftDate(d, 0)).toBe(d);
    expect(shiftDate(d, null)).toBeNull();
    expect(shiftDate(null, 1000)).toBeNull();
  });

  test('relinkIds leaves ids that were not copied alone', () => {
    const ids = new Map([[PAGE, 'new-page']]);
    expect(relinkIds(`a ${PAGE} b ${ACT}`, ids)).toBe(`a new-page b ${ACT}`);
  });
});
