import { describe, expect, test } from 'bun:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { SubmissionService } from './submission.service';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

/**
 * Due date enforcement on the student routes: after the student's effective
 * due date (their extension, else the activity's) nothing new can be
 * started, saved, attached or handed in - except inside a quiz attempt begun
 * in time, which runs to its own end.
 */

const PAST = new Date(Date.now() - 86_400_000);
const FUTURE = new Date(Date.now() + 86_400_000);
const PAST_MESSAGE = /^This was due on .+ UTC\. Ask your teacher for an extension$/;

const ASSIGNMENT = {
  id: 'act-1',
  course_id: 'course-1',
  kind: 'assignment',
  title: 'Essay',
  instructions: null,
  points: 20,
  due_at: PAST as Date | null,
  status: 'published',
  allow_file: true,
  allow_multiple_files: false,
  allow_text: true,
  max_attempts: 1,
  time_limit_minutes: null as number | null,
  lockdown_browser: false,
  rubric_id: null,
};

const QUIZ = { ...ASSIGNMENT, kind: 'quiz', title: 'Quiz' };

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

function build(setup: (prisma: MockPrisma) => void) {
  const prisma = createMockPrisma();
  setup(prisma);
  const service = new SubmissionService(
    prisma as any,
    {
      createSubmissionUploadTicket: () =>
        Promise.resolve({ uploadUrl: 'https://upload' } as any),
      finaliseSubmissionUpload: () =>
        Promise.resolve({ id: 'file-1', name: 'essay.pdf' } as any),
    } as any,
    access as any,
  );
  return { service, prisma };
}

function student(
  over: {
    activity?: any;
    submission?: any;
    extension?: Date | null;
  } = {},
) {
  return (p: MockPrisma) => {
    p.activity.findUnique.mockResolvedValue(over.activity ?? ASSIGNMENT);
    p.student.findUnique.mockResolvedValue({ user_profile_id: 'user-1' });
    p.submission.findFirst.mockResolvedValue(
      over.submission ?? { id: 'sub-1', status: 'draft', file_id: null },
    );
    p.file.findMany.mockResolvedValue([]);
    p.activity_extension.findUnique.mockResolvedValue(
      over.extension ? { due_at: over.extension } : null,
    );
  };
}

const UPLOAD = { name: 'essay.pdf', sizeBytes: 10, contentType: 'application/pdf' };

describe('assignment hand-ins and the due date', () => {
  test('before the due date an assignment can be handed in', async () => {
    const { service } = build((p) => {
      student({ activity: { ...ASSIGNMENT, due_at: FUTURE } })(p);
      p.submission.updateManyAndReturn.mockResolvedValue([
        { id: 'sub-1', status: 'submitted', submitted_at: new Date() },
      ]);
    });
    const res = await service.submitAssignment('stu-1', 'act-1', {
      textBody: 'On time',
    });
    expect(res.status).toBe('submitted');
  });

  test('work with no due date never closes', async () => {
    const { service } = build((p) => {
      student({ activity: { ...ASSIGNMENT, due_at: null } })(p);
      p.submission.updateManyAndReturn.mockResolvedValue([
        { id: 'sub-1', status: 'submitted', submitted_at: new Date() },
      ]);
    });
    const res = await service.submitAssignment('stu-1', 'act-1', {
      textBody: 'Whenever',
    });
    expect(res.status).toBe('submitted');
  });

  test('after the due date the hand-in is a 409', async () => {
    const { service, prisma } = build(student());
    const error = await service
      .submitAssignment('stu-1', 'act-1', { textBody: 'Late' })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toMatch(PAST_MESSAGE);
    expect(prisma.submission.updateManyAndReturn).not.toHaveBeenCalled();
  });

  test('an extension lets the student hand in after the activity date', async () => {
    const { service } = build((p) => {
      student({ extension: FUTURE })(p);
      p.submission.updateManyAndReturn.mockResolvedValue([
        { id: 'sub-1', status: 'submitted', submitted_at: new Date() },
      ]);
    });
    const res = await service.submitAssignment('stu-1', 'act-1', {
      textBody: 'Extended',
    });
    expect(res.status).toBe('submitted');
  });

  test('an extension that has also passed closes the work', async () => {
    const { service } = build(
      student({
        activity: { ...ASSIGNMENT, due_at: new Date(Date.now() - 2 * 86_400_000) },
        extension: PAST,
      }),
    );
    await expect(
      service.submitAssignment('stu-1', 'act-1', { textBody: 'Late' }),
    ).rejects.toThrow(PAST_MESSAGE);
  });

  test('a past-due upload ticket is refused', async () => {
    const { service } = build(student());
    await expect(
      service.createUploadTicket('stu-1', 'act-1', UPLOAD),
    ).rejects.toThrow(PAST_MESSAGE);
  });

  test('a past-due upload is not attached', async () => {
    const { service, prisma } = build(student());
    await expect(
      service.finaliseUploadedFile('stu-1', 'act-1', 'file-1'),
    ).rejects.toThrow(PAST_MESSAGE);
    expect(prisma.submission_file.create).not.toHaveBeenCalled();
  });

  test('uploads work before the due date and with an extension', async () => {
    const before = build(student({ activity: { ...ASSIGNMENT, due_at: FUTURE } }));
    expect(
      await before.service.createUploadTicket('stu-1', 'act-1', UPLOAD),
    ).toEqual({ uploadUrl: 'https://upload' } as any);

    const extended = build((p) => {
      student({ extension: FUTURE })(p);
      p.submission.updateMany.mockResolvedValue({ count: 1 });
    });
    expect(
      await extended.service.finaliseUploadedFile('stu-1', 'act-1', 'file-1'),
    ).toEqual({ fileId: 'file-1', name: 'essay.pdf' });
  });

  test('offline work is still refused as offline, not as late', async () => {
    const { service } = build(
      student({ activity: { ...ASSIGNMENT, kind: 'offline' } }),
    );
    await expect(
      service.submitAssignment('stu-1', 'act-1', { textBody: 'x' }),
    ).rejects.toThrow('This is marked offline; there is nothing to hand in here');
  });
});

describe('quizzes and the due date', () => {
  const lockRow = (over: Record<string, unknown> = {}) => ({
    attempt_count: 0,
    graded_by: null,
    quiz_started_at: null,
    quiz_expires_at: null,
    expired: false,
    ...over,
  });

  test('a quiz cannot be started after its due date', async () => {
    const { service, prisma } = build((p) => {
      student({ activity: QUIZ })(p);
      p.$queryRaw.mockResolvedValue([lockRow()]);
    });
    await expect(service.startQuizAttempt('stu-1', 'act-1')).rejects.toThrow(
      PAST_MESSAGE,
    );
    expect(prisma.submission.update).not.toHaveBeenCalled();
  });

  test('an untimed attempt started before the due date expires at it', async () => {
    const { service, prisma } = build((p) => {
      student({ activity: { ...QUIZ, due_at: FUTURE } })(p);
      p.$queryRaw.mockResolvedValue([lockRow()]);
    });
    const res = await service.startQuizAttempt('stu-1', 'act-1');
    expect(res.expiresAt).toBe(FUTURE.toISOString());
    expect(
      prisma.submission.update.mock.calls[0][0].data.quiz_expires_at,
    ).toEqual(FUTURE);
  });

  test('a timed attempt keeps its full time limit even past the due date', async () => {
    const soon = new Date(Date.now() + 60_000);
    const { service } = build((p) => {
      student({ activity: { ...QUIZ, due_at: soon, time_limit_minutes: 30 } })(p);
      p.$queryRaw.mockResolvedValue([lockRow()]);
    });
    const res = await service.startQuizAttempt('stu-1', 'act-1');
    expect(Date.parse(res.expiresAt!) - Date.parse(res.startedAt)).toBe(
      30 * 60_000,
    );
  });

  test('an extension lets the student start, and the attempt ends at it', async () => {
    const { service } = build((p) => {
      student({ activity: QUIZ, extension: FUTURE })(p);
      p.$queryRaw.mockResolvedValue([lockRow()]);
    });
    const res = await service.startQuizAttempt('stu-1', 'act-1');
    expect(res.expiresAt).toBe(FUTURE.toISOString());
  });

  test('an attempt begun in time can be resumed after the due date', async () => {
    const started = new Date(PAST.getTime() - 60_000);
    const expires = new Date(Date.now() + 600_000);
    const { service, prisma } = build((p) => {
      student({ activity: { ...QUIZ, time_limit_minutes: 30 } })(p);
      p.$queryRaw.mockResolvedValue([
        lockRow({ quiz_started_at: started, quiz_expires_at: expires }),
      ]);
    });
    const res = await service.startQuizAttempt('stu-1', 'act-1');
    expect(res.startedAt).toBe(started.toISOString());
    expect(res.expiresAt).toBe(expires.toISOString());
    expect(prisma.submission.update).not.toHaveBeenCalled();
  });

  test('saving without an attempt after the due date names the date', async () => {
    const { service } = build((p) => {
      student({ activity: QUIZ })(p);
      p.$queryRaw.mockResolvedValue([lockRow()]);
    });
    await expect(service.saveQuizAnswers('stu-1', 'act-1', [])).rejects.toThrow(
      PAST_MESSAGE,
    );
  });

  test('saving inside a timed attempt begun in time works after the due date', async () => {
    const { service, prisma } = build((p) => {
      student({ activity: { ...QUIZ, time_limit_minutes: 30 } })(p);
      p.$queryRaw.mockResolvedValue([
        lockRow({
          quiz_started_at: new Date(PAST.getTime() - 60_000),
          quiz_expires_at: new Date(Date.now() + 600_000),
        }),
      ]);
    });
    const res = await service.saveQuizAnswers('stu-1', 'act-1', []);
    expect(res.savedAt).toBeDefined();
    expect(prisma.submission.update).toHaveBeenCalled();
  });

  test('an attempt with no expiry cannot be saved after the due date', async () => {
    const { service, prisma } = build((p) => {
      student({ activity: QUIZ })(p);
      p.$queryRaw.mockResolvedValue([
        lockRow({ quiz_started_at: new Date(PAST.getTime() - 60_000) }),
      ]);
    });
    await expect(service.saveQuizAnswers('stu-1', 'act-1', [])).rejects.toThrow(
      PAST_MESSAGE,
    );
    expect(prisma.quiz_answer.createMany).not.toHaveBeenCalled();
  });

  test('submitting with no attempt after the due date is a 409', async () => {
    const { service } = build((p) => {
      student({ activity: QUIZ })(p);
    });
    await expect(service.submitQuiz('stu-1', 'act-1', [])).rejects.toThrow(
      PAST_MESSAGE,
    );
  });

  function submitting(attempt: Record<string, unknown>, activity: any = QUIZ) {
    return build((p) => {
      student({
        activity,
        submission: {
          id: 'sub-1',
          status: 'draft',
          quiz_started_at: attempt.quiz_started_at,
        },
      })(p);
      p.quiz_question.findMany.mockResolvedValue([
        { id: 'q-1', kind: 'multiple_choice' },
      ]);
      p.quiz_option.findMany.mockResolvedValue([
        { id: 'opt-1', question_id: 'q-1' },
      ]);
      p.$queryRaw.mockImplementation(async (strings: string[]) => {
        if (strings.join('?').includes('submit_quiz')) {
          return [
            {
              score: new Prisma.Decimal(5),
              points: new Prisma.Decimal(20),
              attempts_used: 1,
            },
          ];
        }
        return [lockRow(attempt)];
      });
    });
  }

  test('a timed attempt begun in time is submitted with its answers after the due date', async () => {
    const { service, prisma } = submitting(
      {
        quiz_started_at: new Date(PAST.getTime() - 60_000),
        quiz_expires_at: new Date(Date.now() + 600_000),
      },
      { ...QUIZ, time_limit_minutes: 30 },
    );
    const res = await service.submitQuiz('stu-1', 'act-1', [
      { questionId: 'q-1', optionId: 'opt-1' },
    ]);
    expect(res).toEqual({ score: 5, points: 20, needsMarking: false });
    expect(prisma.quiz_answer.createMany).toHaveBeenCalled();
  });

  test('an attempt with no expiry past the due date submits only its saved answers', async () => {
    const { service, prisma } = submitting({
      quiz_started_at: new Date(PAST.getTime() - 60_000),
    });
    const res = await service.submitQuiz('stu-1', 'act-1', [
      { questionId: 'q-1', optionId: 'opt-1' },
    ]);
    expect(res).toEqual({ score: 5, points: 20, needsMarking: false });
    expect(prisma.quiz_answer.deleteMany).not.toHaveBeenCalled();
    expect(prisma.quiz_answer.createMany).not.toHaveBeenCalled();
  });

  test('before the due date answers are written and scored', async () => {
    const { service, prisma } = submitting(
      { quiz_started_at: new Date(), quiz_expires_at: FUTURE },
      { ...QUIZ, due_at: FUTURE },
    );
    await service.submitQuiz('stu-1', 'act-1', [
      { questionId: 'q-1', optionId: 'opt-1' },
    ]);
    expect(prisma.quiz_answer.createMany).toHaveBeenCalled();
  });

  test('viewing an untimed attempt left open past the due date submits it', async () => {
    const { service, prisma } = build((p) => {
      student({
        activity: QUIZ,
        submission: {
          id: 'sub-1',
          status: 'draft',
          quiz_started_at: new Date(PAST.getTime() - 60_000),
          quiz_expires_at: null,
          attempt_count: 0,
        },
      })(p);
      p.$queryRaw.mockImplementation(async (strings: string[]) => {
        if (strings.join('?').includes('submit_quiz')) {
          return [
            {
              score: new Prisma.Decimal(0),
              points: new Prisma.Decimal(20),
              attempts_used: 1,
            },
          ];
        }
        return [
          {
            quiz_started_at: new Date(PAST.getTime() - 60_000),
            quiz_expires_at: null,
            expired: false,
          },
        ];
      });
    });
    await service.getForStudent('stu-1', 'act-1');
    const calls = prisma.$queryRaw.mock.calls.map((c: any[]) =>
      (c[0] as string[]).join('?'),
    );
    expect(calls.some((sql: string) => sql.includes('submit_quiz'))).toBe(true);
  });
});

describe('student due fields', () => {
  test('activity detail reports the effective date, the extension and closed', async () => {
    const extended = build(student({ extension: FUTURE }));
    const open = await extended.service.getForStudent('stu-1', 'act-1');
    expect(open.dueAt).toBe(PAST.toISOString());
    expect(open.effectiveDueAt).toBe(FUTURE.toISOString());
    expect(open.hasExtension).toBe(true);
    expect(open.isClosed).toBe(false);

    const late = build(student());
    const closed = await late.service.getForStudent('stu-1', 'act-1');
    expect(closed.effectiveDueAt).toBe(PAST.toISOString());
    expect(closed.hasExtension).toBe(false);
    expect(closed.isClosed).toBe(true);
  });

  test('a quiz in an attempt begun in time is not closed', async () => {
    const { service } = build(
      student({
        activity: { ...QUIZ, time_limit_minutes: 30 },
        submission: {
          id: 'sub-1',
          status: 'draft',
          quiz_started_at: new Date(PAST.getTime() - 60_000),
          quiz_expires_at: new Date(Date.now() + 600_000),
          attempt_count: 0,
        },
      }),
    );
    const detail = await service.getForStudent('stu-1', 'act-1');
    expect(detail.isClosed).toBe(false);
  });

  test('the to-do sorts by each student’s effective due date', async () => {
    const soon = new Date(Date.now() + 3_600_000);
    const { service } = build((p) => {
      p.course_student.findMany.mockResolvedValue([{ course_id: 'course-1' }]);
      p.course.findMany.mockResolvedValue([{ id: 'course-1', name: 'Maths' }]);
      p.activity.findMany.mockResolvedValue([
        { ...ASSIGNMENT, id: 'act-late', due_at: PAST },
        { ...ASSIGNMENT, id: 'act-soon', due_at: soon },
        { ...ASSIGNMENT, id: 'act-undated', due_at: null },
      ]);
      p.activity_extension.findMany.mockResolvedValue([
        { activity_id: 'act-late', due_at: FUTURE },
      ]);
    });
    const list = await service.listForStudent('stu-1');
    expect(list.map((a) => a.id)).toEqual([
      'act-soon',
      'act-late',
      'act-undated',
    ]);
    const late = list.find((a) => a.id === 'act-late')!;
    expect(late.effectiveDueAt).toBe(FUTURE.toISOString());
    expect(late.hasExtension).toBe(true);
    expect(late.isClosed).toBe(false);
  });

  test('the course list carries the due fields', async () => {
    const { service } = build((p) => {
      p.activity.findMany.mockResolvedValue([
        {
          ...ASSIGNMENT,
          assignment_group_id: null,
          published_at: null,
          omit_from_final_grade: false,
          created_at: new Date(),
        },
      ]);
    });
    const [item] = await service.listCourseForStudent('stu-1', 'course-1');
    expect(item.effectiveDueAt).toBe(PAST.toISOString());
    expect(item.hasExtension).toBe(false);
    expect(item.isClosed).toBe(true);
  });
});

describe('teacher roster', () => {
  test('each student carries their extension and effective due date', async () => {
    const { service } = build((p) => {
      p.activity.findUnique.mockResolvedValue({
        id: 'act-1',
        course_id: 'course-1',
        points: 20,
        status: 'published',
        kind: 'assignment',
        lockdown_browser: false,
        due_at: PAST,
      });
      p.course_student.findMany.mockResolvedValue([
        { student_id: 'stu-1', status: 'active' },
        { student_id: 'stu-2', status: 'active' },
      ]);
      p.student.findMany.mockResolvedValue([
        { id: 'stu-1', first_name: 'Ann', last_name: 'A' },
        { id: 'stu-2', first_name: 'Bob', last_name: 'B' },
      ]);
      p.activity_extension.findMany.mockResolvedValue([
        {
          student_id: 'stu-2',
          due_at: FUTURE,
          reason: 'Ill',
          created_by: 'user-1',
          created_at: PAST,
          updated_at: PAST,
        },
      ]);
    });
    const [ann, bob] = await service.listForTeacher('user-1', 'act-1');
    expect(ann.extension).toBeNull();
    expect(ann.effectiveDueAt).toBe(PAST.toISOString());
    expect(bob.extension).toEqual({
      dueAt: FUTURE.toISOString(),
      reason: 'Ill',
      createdBy: 'user-1',
      createdAt: PAST.toISOString(),
      updatedAt: PAST.toISOString(),
    });
    expect(bob.effectiveDueAt).toBe(FUTURE.toISOString());
  });

  test('a student outside the course still gets a 404 before any due check', async () => {
    const prisma = createMockPrisma();
    prisma.activity.findUnique.mockResolvedValue(ASSIGNMENT);
    const service = new SubmissionService(prisma as any, {} as any, {
      requireStudent: async () => {
        throw new NotFoundException('Course not found');
      },
    } as any);
    await expect(
      service.submitAssignment('stu-1', 'act-1', { textBody: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('the late window', () => {
  const LATE_OPEN = {
    ...ASSIGNMENT,
    late_until: FUTURE,
    late_penalty_mode: 'percent_per_day',
    late_penalty_value: 10,
    late_penalty_cap: null,
  };

  test('after the due date but before late-until, a hand-in is accepted and stamped late', async () => {
    const { service, prisma } = build((p) => {
      student({ activity: LATE_OPEN })(p);
      p.submission.updateManyAndReturn.mockResolvedValue([
        { id: 'sub-1', status: 'submitted', submitted_at: new Date() },
      ]);
      p.submission.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          student_id: 'stu-1',
          submitted_at: new Date(),
          attempt_started_at: null,
          score: null,
          raw_score: null,
          late_seconds: 0,
          late_penalty_percent: 0,
          late_penalty_waived: false,
        },
      ]);
    });
    const res = await service.submitAssignment('stu-1', 'act-1', { textBody: 'Late' });
    expect(res.status).toBe('submitted');
    const data = prisma.submission.update.mock.calls[0][0].data;
    // A day and a few milliseconds late: two started days at 10%.
    expect(data.late_seconds).toBeGreaterThan(86_400);
    expect(data.late_penalty_percent).toBe(20);
  });

  test('after late-until the hand-in is a 409 that says late work closed', async () => {
    const { service } = build(
      student({ activity: { ...LATE_OPEN, due_at: new Date(PAST.getTime() - 86_400_000), late_until: PAST } }),
    );
    const error = await service
      .submitAssignment('stu-1', 'act-1', { textBody: 'Too late' })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toMatch(/^Late work closed on/);
  });

  test('an extension wins over late-until: closed at the extension', async () => {
    const soon = new Date(Date.now() - 1000);
    const { service } = build(student({ activity: LATE_OPEN, extension: soon }));
    const error = await service
      .submitAssignment('stu-1', 'act-1', { textBody: 'After my extension' })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toMatch(PAST_MESSAGE);
  });

  test('a quiz can be started late, and the untimed attempt runs to late-until', async () => {
    const { service, prisma } = build((p) => {
      student({ activity: { ...QUIZ, late_until: FUTURE } })(p);
      p.$queryRaw.mockResolvedValue([
        { attempt_count: 0, graded_by: null, quiz_started_at: null, quiz_expires_at: null },
      ]);
    });
    const res = await service.startQuizAttempt('stu-1', 'act-1');
    expect(res.expiresAt).toBe(FUTURE.toISOString());
    expect(prisma.submission.update.mock.calls[0][0].data.quiz_expires_at).toEqual(FUTURE);
  });
});

describe('waiving a late penalty', () => {
  test('restores the raw mark and is audited', async () => {
    const records: any[] = [];
    const prisma = createMockPrisma();
    prisma.activity.findUnique.mockResolvedValue({
      ...ASSIGNMENT,
      late_until: FUTURE,
      late_penalty_mode: 'percent_per_day',
      late_penalty_value: 10,
      late_penalty_cap: null,
    });
    prisma.course_student.findFirst.mockResolvedValue({ student_id: 'stu-1' });
    let waived = false;
    prisma.submission.update.mockImplementation(async ({ data }: any) => {
      if ('late_penalty_waived' in data) waived = data.late_penalty_waived;
      return {};
    });
    const row = () => ({
      id: 'sub-1',
      student_id: 'stu-1',
      status: 'graded',
      submitted_at: new Date(PAST.getTime() + 3_600_000),
      attempt_started_at: null,
      score: 76.5,
      raw_score: 85,
      late_seconds: 3600,
      late_penalty_percent: 10,
      late_penalty_waived: waived,
      feedback: null,
      excused: false,
      excused_reason: null,
      graded_at: new Date(),
    });
    prisma.submission.findUnique.mockImplementation(async () => row());
    prisma.submission.findMany.mockImplementation(async () => [row()]);
    const service = new SubmissionService(
      prisma as any,
      {} as any,
      access as any,
      undefined,
      { record: async (...args: any[]) => void records.push(args) } as any,
    );
    await service.waiveLatePenalty('teacher-1', 'act-1', 'stu-1', true);
    // The penalty is recomputed without the waived percent: score back to 85.
    const scoreWrite = prisma.submission.update.mock.calls.find(
      ([args]: any) => 'score' in args.data,
    );
    expect(scoreWrite?.[0].data.score).toBe(85);
    expect(records[0][3].changes).toBeDefined();
    expect(records[0][3].entity).toBe('submission');
  });

  test('nothing handed in is a 404', async () => {
    const prisma = createMockPrisma();
    prisma.activity.findUnique.mockResolvedValue(ASSIGNMENT);
    prisma.course_student.findFirst.mockResolvedValue({ student_id: 'stu-1' });
    const service = new SubmissionService(prisma as any, {} as any, access as any);
    await expect(service.waiveLatePenalty('t', 'act-1', 'stu-1', true)).rejects.toThrow(
      NotFoundException,
    );
  });
});
