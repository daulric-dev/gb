import { describe, test, expect, mock } from 'bun:test';
import { GradebookImportService } from './gradebook-import.service';
import { csvCell } from './gradebook.service';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

/**
 * Applying an import, and the grade.recorded events after it.
 *
 * One import can change hundreds of marks, so the events must not fan out
 * into hundreds of parallel emits (each a handful of queries) that take the
 * whole connection pool. These pin that: nothing is built when the school has
 * no grade.recorded webhook, shared data is loaded once, the emits go out a
 * few at a time, and each event's data is what it always was.
 */

const ACTIVITIES = [
  { id: 'a1', title: 'Essay', points: 10, kind: 'assignment' },
  { id: 'q1', title: 'Quiz 1', points: 3, kind: 'quiz' },
];

const STUDENT_COUNT = 12;
const STUDENTS = Array.from({ length: STUDENT_COUNT }, (_, i) => ({
  id: `stu-${i + 1}`,
  first_name: `First${i + 1}`,
  last_name: `Last${i + 1}`,
  user_profile: null,
}));

const row = (...cells: string[]) => cells.map(csvCell).join(',');

/** Every student given 5 on the essay and 2 on the quiz: 24 changes. */
const CSV = [
  row('Last name', 'First name', 'Student ID', 'Essay (10)', 'Quiz 1 (3)'),
  ...STUDENTS.map((s) => row(s.last_name, s.first_name, s.id, '5', '2')),
].join('\n');

const courseRef = { id: 'course-1', name: 'Maths', code: 'MAT' };

function recorder() {
  let inFlight = 0;
  const stats = { maxInFlight: 0 };
  const events: { courseId: string; type: string; data: any }[] = [];
  const webhooks = {
    events,
    stats,
    emitForCourse: mock(async (courseId: string, type: string, build: any) => {
      inFlight++;
      stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
      // Hold the slot over a few ticks, as the real queries would.
      for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
      const data = await build(courseRef);
      if (data) events.push({ courseId, type, data });
      inFlight--;
      return 1;
    }),
    student: mock(async (id: string) => ({
      id,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: null,
    })),
    staffOrNull: mock(async (id: string | null) =>
      id ? { id, firstName: 'Tess', lastName: 'Teacher', email: null } : null,
    ),
  };
  return webhooks;
}

function build(opts: { hook?: boolean; webhooks?: any } = {}) {
  const prisma = createMockPrisma();
  prisma.activity.findMany.mockResolvedValue(ACTIVITIES);
  prisma.course_student.findMany.mockResolvedValue(
    STUDENTS.map((s) => ({ student_id: s.id })),
  );
  prisma.student.findMany.mockResolvedValue(STUDENTS);
  prisma.submission.findMany.mockResolvedValue([]);
  prisma.submission.upsert.mockImplementation(async ({ where }: any) => ({
    id: `sub-${where.activity_id_student_id.student_id}-${where.activity_id_student_id.activity_id}`,
  }));
  prisma.course.findUnique.mockResolvedValue({ school_id: 'school-1' });
  prisma.school_webhook.findFirst.mockResolvedValue(
    opts.hook === false ? null : { id: 'hook-1' },
  );
  const access = { require: async () => ({}) };
  const webhooks = opts.webhooks ?? recorder();
  const service = new GradebookImportService(
    prisma as any,
    access as any,
    webhooks,
  );
  return { service, prisma, webhooks };
}

/** Wait for the fire-and-forget emits to finish. */
async function settle(prisma: MockPrisma, webhooks: any, expected: number) {
  for (let i = 0; i < 500; i++) {
    if (webhooks.events.length >= expected) break;
    await new Promise((r) => setTimeout(r, 0));
  }
  // A few more ticks, so anything extra would show up too.
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  return prisma;
}

describe('GradebookImportService.apply events', () => {
  test('nothing is built or emitted when the school has no grade.recorded webhook', async () => {
    const { service, prisma, webhooks } = build({ hook: false });

    const result = await service.apply('user-1', 'course-1', CSV);
    expect(result.applied).toBe(STUDENT_COUNT * 2);
    await settle(prisma, webhooks, 0);

    expect(prisma.school_webhook.findFirst.mock.calls[0][0].where).toEqual({
      school_id: 'school-1',
      enabled: true,
      events: { has: 'grade.recorded' },
    });
    expect(webhooks.emitForCourse).not.toHaveBeenCalled();
    expect(webhooks.student).not.toHaveBeenCalled();
    expect(webhooks.staffOrNull).not.toHaveBeenCalled();
    // Only the plan's own read of the activities.
    expect(prisma.activity.findMany).toHaveBeenCalledTimes(1);
  });

  test('one event per change, in bounded batches, with shared data loaded once', async () => {
    const { service, prisma, webhooks } = build();

    await service.apply('user-1', 'course-1', CSV);
    await settle(prisma, webhooks, STUDENT_COUNT * 2);

    expect(webhooks.events).toHaveLength(STUDENT_COUNT * 2);
    expect(webhooks.stats.maxInFlight).toBeLessThanOrEqual(10);
    expect(webhooks.stats.maxInFlight).toBeGreaterThan(1);

    // The plan reads the activities once, the events once more.
    expect(prisma.activity.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.course.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.school_webhook.findFirst).toHaveBeenCalledTimes(1);
    expect(webhooks.staffOrNull).toHaveBeenCalledTimes(1);
    // Each student once, though each is in two events.
    expect(webhooks.student).toHaveBeenCalledTimes(STUDENT_COUNT);
  });

  test("each event's data is unchanged", async () => {
    const { service, prisma, webhooks } = build();

    await service.apply('user-1', 'course-1', CSV);
    await settle(prisma, webhooks, STUDENT_COUNT * 2);

    const quiz = webhooks.events.find(
      (e: any) =>
        e.data.student.id === 'stu-3' && e.data.activity.id === 'q1',
    );
    expect(quiz.courseId).toBe('course-1');
    expect(quiz.type).toBe('grade.recorded');
    expect(quiz.data).toEqual({
      submission: { id: 'sub-stu-3-q1' },
      activity: { id: 'q1', title: 'Quiz 1', kind: 'quiz', points: 3 },
      course: courseRef,
      student: { id: 'stu-3', firstName: 'Ada', lastName: 'Lovelace', email: null },
      grade: { score: 2, points: 3, status: 'graded', excused: false },
      gradedBy: {
        id: 'user-1',
        firstName: 'Tess',
        lastName: 'Teacher',
        email: null,
      },
      source: 'import',
    });
    expect(Object.keys(quiz.data)).toEqual([
      'submission',
      'activity',
      'course',
      'student',
      'grade',
      'gradedBy',
      'source',
    ]);
  });

  test('a failure while queueing never reaches the import', async () => {
    const { service, prisma, webhooks } = build();
    prisma.course.findUnique.mockRejectedValue(new Error('pool exhausted'));

    const result = await service.apply('user-1', 'course-1', CSV);
    expect(result.applied).toBe(STUDENT_COUNT * 2);
    await settle(prisma, webhooks, 0);
    expect(webhooks.emitForCourse).not.toHaveBeenCalled();
  });
});
