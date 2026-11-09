import { describe, expect, test } from 'bun:test';
import { SubmissionService } from './submission.service';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { createMockCacheService } from '@/test/mocks';

/**
 * Quiz accommodations on the student and roster routes: the attempt's time,
 * Lockdown exemption in presence, the roster and the student's own view.
 */

const FUTURE = new Date(Date.now() + 86_400_000);

const QUIZ = {
  id: 'act-1',
  course_id: 'course-1',
  kind: 'quiz',
  title: 'Quiz',
  instructions: null,
  points: 20,
  due_at: FUTURE as Date | null,
  status: 'published',
  allow_file: false,
  allow_multiple_files: false,
  allow_text: false,
  max_attempts: 1,
  time_limit_minutes: 30 as number | null,
  lockdown_browser: true,
  rubric_id: null,
};

const access = {
  require: async (_u: string, courseId: string) => ({
    course: { id: courseId, school_id: 'school-1' },
    role: 'teacher',
  }),
  requireStudent: async (_s: string, courseId: string) => ({
    id: courseId,
    school_id: 'school-1',
  }),
};

type Acc = {
  time_multiplier?: number | null;
  extra_minutes?: number | null;
  lockdown_exempt?: boolean;
} | null;

const acc = (over: Acc) =>
  over && {
    time_multiplier: null,
    extra_minutes: null,
    lockdown_exempt: false,
    ...over,
  };

function build(
  over: {
    activity?: any;
    submission?: any;
    own?: Acc;
    fallback?: Acc;
  } = {},
  extra: (p: MockPrisma) => void = () => {},
) {
  const prisma = createMockPrisma();
  prisma.activity.findUnique.mockResolvedValue(over.activity ?? QUIZ);
  prisma.submission.findFirst.mockResolvedValue(
    over.submission ?? { id: 'sub-1', status: 'draft', attempt_count: 0 },
  );
  prisma.activity_accommodation.findUnique.mockResolvedValue(
    acc(over.own ?? null),
  );
  prisma.student_accommodation.findUnique.mockResolvedValue(
    acc(over.fallback ?? null),
  );
  prisma.$queryRaw.mockResolvedValue([
    {
      attempt_count: 0,
      graded_by: null,
      quiz_started_at: null,
      quiz_expires_at: null,
    },
  ]);
  extra(prisma);
  const cache = createMockCacheService();
  const service = new SubmissionService(
    prisma as any,
    {} as any,
    access as any,
    undefined,
    undefined,
    cache as any,
  );
  return { service, prisma, cache };
}

const minutes = (res: { startedAt: string; expiresAt: string | null }) =>
  (Date.parse(res.expiresAt!) - Date.parse(res.startedAt)) / 60_000;

describe('starting a timed quiz', () => {
  test('a ×1.5 student gets 45 minutes on a 30-minute quiz', async () => {
    const { service, prisma } = build({ fallback: { time_multiplier: 1.5 } });
    const res = await service.startQuizAttempt('stu-1', 'act-1');
    expect(minutes(res)).toBe(45);
    expect(
      prisma.submission.update.mock.calls[0][0].data.quiz_expires_at,
    ).toEqual(new Date(res.expiresAt!));
  });

  test('extra minutes are added', async () => {
    const { service } = build({ own: { extra_minutes: 20 } });
    expect(minutes(await service.startQuizAttempt('stu-1', 'act-1'))).toBe(50);
  });

  test("the activity's accommodation overrides the default", async () => {
    const { service } = build({
      own: { lockdown_exempt: true },
      fallback: { time_multiplier: 2 },
    });
    expect(minutes(await service.startQuizAttempt('stu-1', 'act-1'))).toBe(30);
  });

  test('no accommodation keeps the time limit', async () => {
    const { service } = build();
    expect(minutes(await service.startQuizAttempt('stu-1', 'act-1'))).toBe(30);
  });

  test('an untimed attempt still ends at the due date', async () => {
    const { service, prisma } = build({
      activity: { ...QUIZ, time_limit_minutes: null },
      fallback: { extra_minutes: 600 },
    });
    const res = await service.startQuizAttempt('stu-1', 'act-1');
    expect(res.expiresAt).toBe(FUTURE.toISOString());
    // Accommodations are not even read for an untimed quiz.
    expect(prisma.student_accommodation.findUnique).not.toHaveBeenCalled();
  });

  test('resuming returns the stamped expiry unchanged', async () => {
    const started = new Date(Date.now() - 60_000);
    const expires = new Date(started.getTime() + 45 * 60_000);
    const { service, prisma } = build(
      { fallback: { time_multiplier: 2 } },
      (p) => {
        p.$queryRaw.mockResolvedValue([
          {
            attempt_count: 0,
            graded_by: null,
            quiz_started_at: started,
            quiz_expires_at: expires,
          },
        ]);
      },
    );
    const res = await service.startQuizAttempt('stu-1', 'act-1');
    expect(res.expiresAt).toBe(expires.toISOString());
    expect(prisma.submission.update).not.toHaveBeenCalled();
  });
});

describe('Lockdown exemption', () => {
  const running = {
    id: 'sub-1',
    status: 'draft',
    quiz_started_at: new Date(Date.now() - 10_000),
    quiz_expires_at: new Date(Date.now() + 600_000),
    is_away: false,
    tab_switch_count: 0,
  };

  test('presence is a no-op for an exempt student', async () => {
    const { service, prisma, cache } = build({
      submission: running,
      fallback: { lockdown_exempt: true },
    });
    const res = await service.updateQuizPresence('stu-1', 'act-1', {
      isAway: true,
      reason: 'blur',
    });
    expect(res).toEqual({ ok: true });
    expect(prisma.submission.update).not.toHaveBeenCalled();
    expect(cache._store.size).toBe(0);
  });

  test('presence is still recorded for everyone else', async () => {
    const { service, prisma } = build({ submission: running });
    await service.updateQuizPresence('stu-1', 'act-1', {
      isAway: true,
      reason: 'blur',
    });
    expect(prisma.submission.update).toHaveBeenCalled();
  });

  test("the student's view reports no Lockdown and their own time", async () => {
    const { service } = build({
      submission: null as any,
      fallback: { time_multiplier: 1.5, lockdown_exempt: true },
    }, (p) => {
      p.submission.findFirst.mockResolvedValue(null);
      p.quiz_question.findMany.mockResolvedValue([]);
    });
    const view = await service.getForStudent('stu-1', 'act-1');
    expect(view.lockdownBrowser).toBe(false);
    expect(view.timeLimitMinutes).toBe(45);
    expect(view.standardTimeLimitMinutes).toBe(30);
    expect(view).not.toHaveProperty('accommodation');
  });

  test('without an accommodation the view is the quiz as set', async () => {
    const { service } = build({}, (p) => {
      p.submission.findFirst.mockResolvedValue(null);
      p.quiz_question.findMany.mockResolvedValue([]);
    });
    const view = await service.getForStudent('stu-1', 'act-1');
    expect(view.lockdownBrowser).toBe(true);
    expect(view.timeLimitMinutes).toBe(30);
  });

  test('the course list reports the same per activity', async () => {
    const { service } = build({}, (p) => {
      p.activity.findMany.mockResolvedValue([
        { ...QUIZ, assignment_group_id: null, created_at: new Date() },
      ]);
      p.activity_accommodation.findMany.mockResolvedValue([
        {
          activity_id: 'act-1',
          time_multiplier: '2',
          extra_minutes: null,
          lockdown_exempt: true,
        },
      ]);
    });
    const [item] = await service.listCourseForStudent('stu-1', 'course-1');
    expect(item.timeLimitMinutes).toBe(60);
    expect(item.lockdownBrowser).toBe(false);
  });
});

describe('teacher roster', () => {
  function roster(extra: (p: MockPrisma) => void) {
    return build({}, (p) => {
      p.activity.findUnique.mockResolvedValue({
        id: 'act-1',
        course_id: 'course-1',
        points: 20,
        status: 'published',
        kind: 'quiz',
        lockdown_browser: true,
        due_at: FUTURE,
      });
      p.course_student.findMany.mockResolvedValue([
        { student_id: 'stu-1', status: 'active' },
        { student_id: 'stu-2', status: 'active' },
      ]);
      p.student.findMany.mockResolvedValue([
        { id: 'stu-1', first_name: 'Ann', last_name: 'A' },
        { id: 'stu-2', first_name: 'Bob', last_name: 'B' },
      ]);
      // Both mid-attempt with no heartbeat for a minute: stale, so away.
      const started = new Date(Date.now() - 60_000);
      p.submission.findMany.mockResolvedValue(
        ['stu-1', 'stu-2'].map((id) => ({
          id: `sub-${id}`,
          student_id: id,
          status: 'draft',
          quiz_started_at: started,
          quiz_expires_at: new Date(Date.now() + 600_000),
          is_away: false,
          tab_switch_count: 0,
        })),
      );
      extra(p);
    });
  }

  test("each student's effective accommodation; exempt is never away", async () => {
    const { service } = roster((p) => {
      p.student_accommodation.findMany.mockResolvedValue([
        {
          student_id: 'stu-2',
          time_multiplier: '1.5',
          extra_minutes: null,
          lockdown_exempt: true,
        },
      ]);
    });
    const [ann, bob] = await service.listForTeacher('user-1', 'act-1');
    expect(ann.accommodation).toBeNull();
    expect(ann.submission?.isAway).toBe(true);
    expect(bob.accommodation).toEqual({
      source: 'student',
      timeMultiplier: 1.5,
      extraMinutes: null,
      lockdownExempt: true,
    });
    expect(bob.submission?.isAway).toBe(false);
    expect(bob.defaultAccommodation).toEqual(bob.accommodation);
  });

  test("an activity's row wins over the default in the roster", async () => {
    const { service } = roster((p) => {
      p.activity_accommodation.findMany.mockResolvedValue([
        {
          student_id: 'stu-1',
          time_multiplier: null,
          extra_minutes: 15,
          lockdown_exempt: false,
        },
      ]);
      p.student_accommodation.findMany.mockResolvedValue([
        {
          student_id: 'stu-1',
          time_multiplier: '2',
          extra_minutes: null,
          lockdown_exempt: true,
        },
      ]);
    });
    const [ann] = await service.listForTeacher('user-1', 'act-1');
    expect(ann.accommodation).toMatchObject({
      source: 'activity',
      extraMinutes: 15,
      lockdownExempt: false,
    });
    expect(ann.submission?.isAway).toBe(true);
    expect(ann.defaultAccommodation).toMatchObject({
      source: 'student',
      timeMultiplier: 2,
    });
  });
});
