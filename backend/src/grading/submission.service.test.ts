import { describe, test, expect } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { Readable } from 'node:stream';
import { SubmissionService } from './submission.service';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { createMockCacheService } from '@/test/mocks';

/**
 * File handling, marking and excusing on submissions.
 *
 * The student is the file's owner but holds no catalog permissions, so the
 * portal endpoint is their only way to upload; the teacher is not the owner
 * and has no share, so their read is authorised by their role in the course.
 * Both sides sit outside the file manager's own rules, which is why they are
 * tested here. Course access itself is CourseAccessService, stubbed below.
 */

const ACTIVITY = {
  id: 'act-1',
  course_id: 'course-1',
  kind: 'assignment',
  title: 'Essay',
  instructions: null,
  points: 20,
  due_at: null,
  status: 'published',
  allow_file: true,
  allow_multiple_files: false,
  allow_text: true,
};

/**
 * Course access: `staff` is the caller's course role (null for none) and
 * `enrolled` whether the student may see the course.
 */
function stubAccess(
  opts: { staff?: 'teacher' | 'ta' | null; enrolled?: boolean } = {},
) {
  const staff = opts.staff === undefined ? 'teacher' : opts.staff;
  const enrolled = opts.enrolled ?? true;
  return {
    require: async (_u: string, courseId: string, roles: readonly string[]) => {
      if (!staff) throw new NotFoundException('Course not found');
      if (!roles.includes(staff)) throw new ForbiddenException('nope');
      return { course: { id: courseId }, role: staff };
    },
    requireStudent: async (_s: string, courseId: string) => {
      if (!enrolled) throw new NotFoundException('Course not found');
      return { id: courseId, school_id: 'school-1', grade_scale_id: null };
    },
    courseIdOfActivity: async () => 'course-1',
  };
}

function build(
  setup: (prisma: MockPrisma) => void,
  files: Partial<Record<string, any>> = {},
  access: ReturnType<typeof stubAccess> = stubAccess(),
  auditLog?: { record: (...args: any[]) => Promise<void> },
  cache?: any,
) {
  const prisma = createMockPrisma();
  setup(prisma);
  const service = new SubmissionService(
    prisma as any,
    {
      createSubmissionUploadTicket: () =>
        Promise.resolve({ uploadUrl: 'unused' } as any),
      finaliseSubmissionUpload: () =>
        Promise.resolve({ id: 'file-1', name: 'essay.pdf' } as any),
      readContentForAuthorisedCaller: () =>
        Promise.resolve({
          buffer: Buffer.from('hi'),
          contentType: 'application/pdf',
          filename: 'essay.pdf',
        }),
      ...files,
    } as any,
    access as any,
    undefined,
    auditLog as any,
    cache as any,
  );
  return { service, prisma };
}

/** The lookups every student-side call makes before it does anything. */
function studentTables(
  over: { activity?: any; submission?: any } = {},
): (prisma: MockPrisma) => void {
  return (p) => {
    p.activity.findUnique.mockResolvedValue(over.activity ?? { ...ACTIVITY });
    p.student.findUnique.mockResolvedValue({ user_profile_id: 'user-1' });
    p.submission.findFirst.mockResolvedValue(
      over.submission ?? { id: 'sub-1', status: 'draft', file_id: null },
    );
    p.file.findMany.mockResolvedValue([]);
  };
}

describe('SubmissionService file handling', () => {
  test('audits a durable assignment hand-in with the student account as actor', async () => {
    let args: any[] = [];
    const auditLog = {
      record: async (...recordArgs: any[]) => {
        args = recordArgs;
      },
    };
    const { service, prisma } = build(
      (p) => {
        studentTables()(p);
        p.submission.findUnique.mockResolvedValue({
          id: 'sub-1',
          status: 'draft',
          text_body: null,
          file_id: null,
        });
        p.submission.updateManyAndReturn.mockResolvedValue([
          { id: 'sub-1', status: 'submitted', submitted_at: new Date() },
        ]);
      },
      {},
      stubAccess(),
      auditLog,
    );

    await service.submitAssignment('stu-1', 'act-1', { textBody: 'My essay' });

    expect(args[0]).toBe(prisma);
    expect(args[1]).toBe('school-1');
    expect(args[2]).toEqual({ id: 'user-1' });
    expect(args[3].entity).toBe('submission');
    expect(args[3].entityId).toBe('sub-1');
    expect(args[3].action).toBe('update');
    expect(args[3].changes.status).toEqual({
      before: 'draft',
      after: 'submitted',
    });
    expect(args[3].changes.textBody).toEqual({
      before: null,
      after: 'My essay',
    });
  });

  test('finaliseUploadedFile stores the uploaded id on the draft', async () => {
    const { service, prisma } = build((p) => {
      studentTables()(p);
      p.submission.updateMany.mockResolvedValue({ count: 1 });
    });

    const result = await service.finaliseUploadedFile(
      'stu-1',
      'act-1',
      'file-1',
    );

    expect(result).toEqual({ fileId: 'file-1', name: 'essay.pdf' });

    const update = prisma.submission.updateMany.mock.calls
      .map(([args]) => args)
      .find((args) => args.data.file_id === 'file-1');
    if (!update) throw new Error('expected the draft to be updated');
    expect(update.data.file_id).toBe('file-1');
    expect(update.where.id).toBe('sub-1');
  });

  test('createUploadTicket refuses an assignment that does not accept files', async () => {
    const { service } = build(
      studentTables({ activity: { ...ACTIVITY, allow_file: false } }),
    );

    await expect(
      service.createUploadTicket('stu-1', 'act-1', {
        name: 'essay.pdf',
        sizeBytes: 10,
        contentType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('createUploadTicket refuses a quiz', async () => {
    const { service } = build(
      studentTables({ activity: { ...ACTIVITY, kind: 'quiz' } }),
    );

    await expect(
      service.createUploadTicket('stu-1', 'act-1', {
        name: 'essay.pdf',
        sizeBytes: 10,
        contentType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('createUploadTicket refuses once the work is already handed in', async () => {
    const { service } = build(
      studentTables({
        submission: { id: 'sub-1', status: 'submitted', file_id: 'file-0' },
      }),
    );

    await expect(
      service.createUploadTicket('stu-1', 'act-1', {
        name: 'essay.pdf',
        sizeBytes: 10,
        contentType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  test('upload tickets stop at the submission file limit', async () => {
    const { service, prisma } = build(studentTables());
    prisma.submission_file.count.mockResolvedValue(20);

    await expect(
      service.createUploadTicket('stu-1', 'act-1', {
        name: 'extra.pdf',
        sizeBytes: 10,
        contentType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('single-file assignments reject another upload ticket', async () => {
    let ticketRequested = false;
    const createUploadTicket = async () => {
      ticketRequested = true;
      return { uploadUrl: 'unused' };
    };
    const { service, prisma } = build(studentTables(), {
      createSubmissionUploadTicket: createUploadTicket,
    });
    prisma.submission_file.count.mockResolvedValue(1);

    await expect(
      service.createUploadTicket('stu-1', 'act-1', {
        name: 'second.pdf',
        sizeBytes: 10,
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow('This assignment allows only one file');
    expect(ticketRequested).toBe(false);
  });

  test('multiple-file assignments allow a second upload ticket', async () => {
    let ticketRequested = false;
    const createUploadTicket = async () => {
      ticketRequested = true;
      return { uploadUrl: 'unused' };
    };
    const { service, prisma } = build(
      studentTables({
        activity: { ...ACTIVITY, allow_multiple_files: true },
      }),
      { createSubmissionUploadTicket: createUploadTicket },
    );
    prisma.submission_file.count.mockResolvedValue(1);

    await service.createUploadTicket('stu-1', 'act-1', {
      name: 'second.pdf',
      sizeBytes: 10,
      contentType: 'application/pdf',
    });
    expect(ticketRequested).toBe(true);
  });

  test('submitting text keeps a file attached earlier', async () => {
    const { service, prisma } = build((p) => {
      studentTables({
        submission: { id: 'sub-1', status: 'draft', file_id: 'file-1' },
      })(p);
      p.submission.updateManyAndReturn.mockResolvedValue([
        { id: 'sub-1', status: 'submitted', submitted_at: null },
      ]);
    });

    await service.submitAssignment('stu-1', 'act-1', { textBody: 'My essay' });

    const update = prisma.submission.updateManyAndReturn.mock.calls[0]?.[0];
    if (!update) throw new Error('expected the submission to be updated');
    expect(update.data.file_id).toBe('file-1');
    expect(update.data.text_body).toBe('My essay');
    expect(update.where).toEqual({ id: 'sub-1', status: 'draft' });
  });

  test('a file alone is enough to hand in', async () => {
    const { service } = build((p) => {
      studentTables({
        activity: { ...ACTIVITY, allow_text: false },
        submission: { id: 'sub-1', status: 'draft', file_id: 'file-1' },
      })(p);
      p.submission.updateManyAndReturn.mockResolvedValue([
        { id: 'sub-1', status: 'submitted', submitted_at: null },
      ]);
    });

    const result = await service.submitAssignment('stu-1', 'act-1', {});
    expect(result).toBeTruthy();
  });

  test('an assignment cannot be submitted after its due date', async () => {
    const { service, prisma } = build((p) => {
      studentTables({
        activity: {
          ...ACTIVITY,
          due_at: new Date('2026-10-01T12:00:00.000Z'),
        },
      })(p);
    });

    await expect(
      service.submitAssignment('stu-1', 'act-1', { textBody: 'My late work' }),
    ).rejects.toThrow(
      'This was due on 2026-10-01 12:00 UTC. Ask your teacher for an extension',
    );
    expect(prisma.submission.updateManyAndReturn).not.toHaveBeenCalled();
  });

  test('an empty draft cannot be handed in', async () => {
    const { service } = build(studentTables());

    await expect(
      service.submitAssignment('stu-1', 'act-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('someone with no role in the course cannot read the file', async () => {
    let read = false;
    const { service } = build(
      (p) =>
        p.submission.findUnique.mockResolvedValue({
          id: 'sub-1',
          activity_id: 'act-1',
          file_id: 'file-1',
        }),
      {
        readContentForAuthorisedCaller: () => {
          read = true;
          return Promise.resolve({} as any);
        },
      },
      stubAccess({ staff: null }),
    );

    await expect(
      service.readSubmissionFile('user-9', 'sub-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(read).toBe(false);
  });

  test('a TA in the course reads the bytes', async () => {
    const { service } = build(
      (p) =>
        p.submission.findUnique.mockResolvedValue({
          id: 'sub-1',
          activity_id: 'act-1',
          file_id: 'file-1',
        }),
      {},
      stubAccess({ staff: 'ta' }),
    );

    const result = await service.readSubmissionFile('user-1', 'sub-1');
    expect(result.filename).toBe('essay.pdf');
  });

  test('a TA can read a selected attachment on a multi-file submission', async () => {
    let readFileId: string | undefined;
    const { service } = build(
      (p) =>
        p.submission.findUnique.mockResolvedValue({
          id: 'sub-1',
          activity_id: 'act-1',
          file_id: 'file-1',
          submission_file: [{ file_id: 'file-1' }, { file_id: 'file-2' }],
        }),
      {
        readContentForAuthorisedCaller: (fileId: string) => {
          readFileId = fileId;
          return Promise.resolve({ filename: 'second.pdf' } as any);
        },
      },
    );

    const result = await service.readSubmissionFile(
      'user-1',
      'sub-1',
      'file-2',
    );
    expect(readFileId).toBe('file-2');
    expect(result.filename).toBe('second.pdf');
  });

  test('a submission ZIP contains every attachment with unique names', async () => {
    const { service } = build(
      (p) =>
        p.submission.findUnique.mockResolvedValue({
          id: 'sub-1',
          activity_id: 'act-1',
          file_id: 'file-1',
          activity: { title: 'Essay', course_id: 'course-1' },
          student: { first_name: 'Ada', last_name: 'Lovelace' },
          submission_file: [
            { file_id: 'file-1', file: { name: 'essay.pdf' } },
            { file_id: 'file-2', file: { name: 'essay.pdf' } },
          ],
        }),
      {
        readStreamForAuthorisedCaller: () => ({
          body: Readable.from([Buffer.from('file contents')]),
        }),
      },
    );

    const { archive, archiveName } = await service.readSubmissionArchive(
      'user-1',
      'sub-1',
    );
    const chunks: Buffer[] = [];
    for await (const chunk of archive) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const zip = Buffer.concat(chunks);

    expect(archiveName).toBe('Ada Lovelace - Essay.zip');
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(zip.toString('latin1')).toContain('essay.pdf');
    expect(zip.toString('latin1')).toContain('essay (2).pdf');
  });

  test('there is nothing to read when no file was handed in', async () => {
    const { service } = build((p) =>
      p.submission.findUnique.mockResolvedValue({
        id: 'sub-1',
        activity_id: 'act-1',
        file_id: null,
      }),
    );

    await expect(
      service.readSubmissionFile('user-1', 'sub-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SubmissionService student access', () => {
  test('a student not in the course cannot see the activity', async () => {
    const { service } = build(
      studentTables(),
      {},
      stubAccess({ enrolled: false }),
    );
    await expect(
      service.getForStudent('stu-1', 'act-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('a draft activity is not visible', async () => {
    const { service } = build(
      studentTables({ activity: { ...ACTIVITY, status: 'draft' } }),
    );
    await expect(
      service.getForStudent('stu-1', 'act-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('offline work can be viewed but not handed in', async () => {
    const tables = studentTables({
      activity: {
        ...ACTIVITY,
        kind: 'offline',
        allow_file: false,
        allow_text: false,
      },
    });
    const { service } = build(tables);

    const view = await service.getForStudent('stu-1', 'act-1');
    expect(view.kind).toBe('offline');

    await expect(
      service.submitAssignment('stu-1', 'act-1', { textBody: 'x' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.createUploadTicket('stu-1', 'act-1', {
        name: 'essay.pdf',
        sizeBytes: 10,
        contentType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.submitQuiz('stu-1', 'act-1', []),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  test('score and feedback are hidden until graded', async () => {
    const { service } = build(
      studentTables({
        submission: {
          id: 'sub-1',
          status: 'submitted',
          score: 12,
          feedback: 'half done',
          excused: false,
        },
      }),
    );
    const view = await service.getForStudent('stu-1', 'act-1');
    expect(view.submission!.score).toBeNull();
    expect(view.submission!.feedback).toBeNull();
  });

  test('a quiz submission never writes grading.grade', async () => {
    const { service, prisma } = build((p) => {
      studentTables({
        activity: { ...ACTIVITY, kind: 'quiz', max_attempts: null },
        submission: {
          id: 'sub-1',
          status: 'draft',
          attempt_count: 0,
          quiz_started_at: new Date('2026-11-05T10:00:00Z'),
        },
      })(p);
      p.quiz_question.findMany.mockResolvedValue([]);
      p.$queryRaw.mockImplementation(async (strings: string[]) => {
        if (strings.join('?').includes('submit_quiz')) {
          return [
            { score: new Prisma.Decimal(5), points: new Prisma.Decimal(20) },
          ];
        }
        return [
          {
            attempt_count: 0,
            graded_by: null,
            quiz_started_at: new Date('2026-11-05T10:00:00Z'),
            expired: false,
          },
        ];
      });
    });

    const result = await service.submitQuiz('stu-1', 'act-1', []);
    expect(result).toEqual({ score: 5, points: 20 });
    // The row lock, then submit_quiz.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.grade.create).not.toHaveBeenCalled();
    expect(prisma.grade.upsert).not.toHaveBeenCalled();
  });

  test('submit_quiz refusals map to 409s', async () => {
    const raised = (message: string) =>
      new Prisma.PrismaClientKnownRequestError(`Raw query failed: ${message}`, {
        code: 'P2010',
        clientVersion: 'test',
        meta: { code: 'P0001', message },
      });
    for (const [message, expected] of [
      ['no_attempts_left', 'You have no attempts left'],
      ['activity_not_open', 'This quiz is closed'],
      ['quiz_attempt_not_started', 'Start the quiz before submitting'],
    ]) {
      const { service } = build((p) => {
        studentTables({
          activity: { ...ACTIVITY, kind: 'quiz', max_attempts: null },
          submission: {
            id: 'sub-1',
            status: 'draft',
            attempt_count: 0,
            quiz_started_at: new Date('2026-11-05T10:00:00Z'),
          },
        })(p);
        p.$queryRaw.mockImplementation(async (strings: string[]) => {
          if (strings.join('?').includes('submit_quiz')) {
            throw raised(message);
          }
          return [
            {
              attempt_count: 0,
              graded_by: null,
              quiz_started_at: new Date('2026-11-05T10:00:00Z'),
              expired: false,
            },
          ];
        });
      });
      const err = await service
        .submitQuiz('stu-1', 'act-1', [])
        .catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(expected);
    }
  });

  test('a quiz a teacher has marked cannot be retaken', async () => {
    const { service, prisma } = build(
      studentTables({
        activity: { ...ACTIVITY, kind: 'quiz', max_attempts: null },
        submission: {
          id: 'sub-1',
          status: 'graded',
          attempt_count: 1,
          graded_by: 'teacher-1',
          quiz_started_at: new Date('2026-11-05T10:00:00Z'),
        },
      }),
    );
    const err = await service.submitQuiz('stu-1', 'act-1', []).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(prisma.quiz_answer.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  test('submit_quiz already_marked (marked mid-retake) maps to a 400', async () => {
    const { service } = build((p) => {
      studentTables({
        activity: { ...ACTIVITY, kind: 'quiz', max_attempts: null },
        submission: {
          id: 'sub-1',
          status: 'draft',
          attempt_count: 0,
          quiz_started_at: new Date('2026-11-05T10:00:00Z'),
        },
      })(p);
      p.quiz_question.findMany.mockResolvedValue([]);
      p.$queryRaw.mockImplementation(async (strings: string[]) => {
        if (strings.join('?').includes('submit_quiz')) {
          throw new Prisma.PrismaClientKnownRequestError(
            'Raw query failed: already_marked',
            {
              code: 'P2010',
              clientVersion: 'test',
              meta: { code: 'P0025', message: 'already_marked' },
            },
          );
        }
        return [
          {
            attempt_count: 0,
            graded_by: null,
            quiz_started_at: new Date('2026-11-05T10:00:00Z'),
            expired: false,
          },
        ];
      });
    });
    const err = await service.submitQuiz('stu-1', 'act-1', []).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
  });

  /**
   * A quiz with two choice questions and one short answer, whose raw calls
   * are the submission row lock and then submit_quiz. `order` records every
   * write and raw call as it happens.
   */
  function quizTables(
    over: {
      draft?: any;
      locked?: any;
      maxAttempts?: number | null;
      submit?: () => Promise<any>;
    } = {},
  ) {
    const order: string[] = [];
    const setup = (p: MockPrisma) => {
      studentTables({
        activity: {
          ...ACTIVITY,
          kind: 'quiz',
          max_attempts:
            over.maxAttempts === undefined ? null : over.maxAttempts,
        },
        submission: over.draft ?? {
          id: 'sub-1',
          status: 'draft',
          attempt_count: 0,
          graded_by: null,
          quiz_started_at: new Date('2026-11-05T10:00:00Z'),
        },
      })(p);
      p.quiz_question.findMany.mockResolvedValue([
        { id: 'q-1', kind: 'multiple_choice' },
        { id: 'q-2', kind: 'true_false' },
        { id: 'q-3', kind: 'short_answer' },
      ]);
      p.quiz_option.findMany.mockResolvedValue([
        { id: 'o-1a', question_id: 'q-1' },
        { id: 'o-1b', question_id: 'q-1' },
        { id: 'o-2a', question_id: 'q-2' },
      ]);
      p.quiz_answer.deleteMany.mockImplementation(async () => {
        order.push('delete answers');
        return { count: 0 };
      });
      p.quiz_answer.createMany.mockImplementation(async () => {
        order.push('write answers');
        return { count: 0 };
      });
      p.$queryRaw.mockImplementation(async (strings: string[]) => {
        if (strings.join('?').includes('submit_quiz')) {
          order.push('submit_quiz');
          if (over.submit) return over.submit();
          return [{ score: 10, points: 20, attempts_used: 1 }];
        }
        order.push('lock');
        return [
          over.locked ?? {
            attempt_count: 0,
            graded_by: null,
            quiz_started_at: new Date('2026-11-05T10:00:00Z'),
            expired: false,
          },
        ];
      });
    };
    return { order, setup };
  }

  test('quiz answers are written and scored in one transaction, after the row lock', async () => {
    const { order, setup } = quizTables();
    const { service, prisma } = build(setup);

    await service.submitQuiz('stu-1', 'act-1', [
      { questionId: 'q-1', optionId: 'o-1a' },
    ]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(typeof prisma.$transaction.mock.calls[0][0]).toBe('function');
    expect(order).toEqual([
      'lock',
      'delete answers',
      'write answers',
      'submit_quiz',
    ]);
    const lockSql = (prisma.$queryRaw.mock.calls[0][0] as string[]).join('?');
    expect(lockSql).toContain('grading.submission');
    expect(lockSql).toContain('for update');
    // Every earlier answer goes, not just those to questions sent this time.
    expect(prisma.quiz_answer.deleteMany.mock.calls[0][0].where).toEqual({
      submission_id: 'sub-1',
      quiz_question: { activity_id: 'act-1' },
    });
  });

  test('a repeated question keeps only its last answer', async () => {
    const { setup } = quizTables();
    const { service, prisma } = build(setup);

    await service.submitQuiz('stu-1', 'act-1', [
      { questionId: 'q-1', optionId: 'o-1a' },
      { questionId: 'q-3', text: ' first ' },
      { questionId: 'q-1', optionId: 'o-1b' },
      { questionId: 'q-3', text: ' second ' },
      // Another question's option is still not an answer here.
      { questionId: 'q-2', optionId: 'o-1a' },
    ]);

    expect(prisma.quiz_answer.createMany.mock.calls[0][0].data).toEqual([
      {
        submission_id: 'sub-1',
        question_id: 'q-1',
        option_id: 'o-1b',
        text_answer: null,
      },
      {
        submission_id: 'sub-1',
        question_id: 'q-3',
        option_id: null,
        text_answer: 'second',
      },
    ]);
  });

  test('a submit that lost the race for the last attempt writes no answers', async () => {
    // Both read attempt_count 0; by the time this one holds the lock the
    // other has used the only attempt.
    const { order, setup } = quizTables({
      maxAttempts: 1,
      locked: {
        attempt_count: 1,
        graded_by: null,
        quiz_started_at: new Date('2026-11-05T10:00:00Z'),
        expired: false,
      },
    });
    const { service, prisma } = build(setup);

    const err = await service
      .submitQuiz('stu-1', 'act-1', [{ questionId: 'q-1', optionId: 'o-1a' }])
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('You have no attempts left');
    expect(order).toEqual(['lock']);
    expect(prisma.quiz_answer.deleteMany).not.toHaveBeenCalled();
    expect(prisma.quiz_answer.createMany).not.toHaveBeenCalled();
  });

  test('a quiz marked by the teacher while the student answered writes no answers', async () => {
    const { order, setup } = quizTables({
      locked: {
        attempt_count: 1,
        graded_by: 'teacher-1',
        quiz_started_at: new Date('2026-11-05T10:00:00Z'),
        expired: false,
      },
    });
    const { service } = build(setup);

    const err = await service
      .submitQuiz('stu-1', 'act-1', [{ questionId: 'q-1', optionId: 'o-1a' }])
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(order).toEqual(['lock']);
  });

  test('a refusal inside submit_quiz fails the transaction holding the answers', async () => {
    const { setup } = quizTables({
      submit: () =>
        Promise.reject(
          new Prisma.PrismaClientKnownRequestError(
            'Raw query failed: activity_not_open',
            {
              code: 'P2010',
              clientVersion: 'test',
              meta: { code: 'P0024', message: 'activity_not_open' },
            },
          ),
        ),
    });
    let rolledBack = false;
    const { service } = build((p) => {
      setup(p);
      const run = p.$transaction.getMockImplementation()!;
      p.$transaction.mockImplementation((arg: any) =>
        Promise.resolve(run(arg)).catch((e) => {
          rolledBack = true;
          throw e;
        }),
      );
    });

    const err = await service
      .submitQuiz('stu-1', 'act-1', [{ questionId: 'q-1', optionId: 'o-1a' }])
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('This quiz is closed');
    expect(rolledBack).toBe(true);
  });

  test('two first touches at once share the one draft', async () => {
    const { service, prisma } = build((p) => {
      studentTables({
        activity: { ...ACTIVITY, kind: 'quiz', max_attempts: null },
      })(p);
      // Missing on the first look; the other request's row on the second.
      p.submission.findFirst.mockResolvedValueOnce(null).mockResolvedValue({
        id: 'sub-other',
        status: 'draft',
        attempt_count: 0,
        graded_by: null,
        quiz_started_at: new Date('2026-11-05T10:00:00Z'),
      });
      p.submission.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      p.$queryRaw.mockImplementation(async (strings: string[]) =>
        strings.join('?').includes('submit_quiz')
          ? [{ score: 0, points: 20, attempts_used: 1 }]
          : [
              {
                attempt_count: 0,
                graded_by: null,
                quiz_started_at: new Date('2026-11-05T10:00:00Z'),
                expired: false,
              },
            ],
      );
    });

    await service.submitQuiz('stu-1', 'act-1', []);
    expect(prisma.submission.create).toHaveBeenCalledTimes(1);
    expect(prisma.quiz_answer.deleteMany.mock.calls[0][0].where).toEqual({
      submission_id: 'sub-other',
      quiz_question: { activity_id: 'act-1' },
    });
  });

  test('a draft that cannot be created for any other reason is a 400', async () => {
    const { service } = build((p) => {
      studentTables({
        activity: { ...ACTIVITY, kind: 'quiz', max_attempts: null },
      })(p);
      p.submission.findFirst.mockResolvedValue(null);
      p.submission.create.mockRejectedValue(new Error('connection reset'));
    });
    await expect(
      service.submitQuiz('stu-1', 'act-1', []),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('finaliseUploadedFile refuses a closed assignment', async () => {
    const finaliseUpload = () =>
      Promise.resolve({ id: 'file-1', name: 'essay.pdf' });
    const { service, prisma } = build(
      studentTables({ activity: { ...ACTIVITY, status: 'closed' } }),
      { finaliseUpload },
    );
    await expect(
      service.finaliseUploadedFile('stu-1', 'act-1', 'file-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.submission.updateMany).not.toHaveBeenCalled();
  });

  test('the course list maps to the PortalCourseActivity contract', async () => {
    const { service } = build((p) => {
      p.activity.findMany.mockResolvedValue([
        {
          ...ACTIVITY,
          status: 'published',
          assignment_group_id: null,
          published_at: new Date('2026-09-01T00:00:00Z'),
          omit_from_final_grade: true,
          created_at: new Date('2026-09-01T00:00:00Z'),
        },
      ]);
      p.submission.findMany.mockResolvedValue([
        {
          activity_id: 'act-1',
          status: 'graded',
          score: new Prisma.Decimal(18),
          excused: false,
          feedback: 'Good',
          submitted_at: new Date('2026-09-02T00:00:00Z'),
          attempt_count: 0,
        },
      ]);
    });

    const [item] = await service.listCourseForStudent('stu-1', 'course-1');
    expect(item).not.toHaveProperty('omitFromFinalGrade');
    expect(item).not.toHaveProperty('createdAt');
    expect(item.courseId).toBe('course-1');
    expect(item.submission).toEqual({
      status: 'graded',
      score: 18,
      excused: false,
      attemptCount: 0,
      submittedAt: '2026-09-02T00:00:00.000Z',
      feedback: 'Good',
    });
  });
});

describe('SubmissionService marking', () => {
  const PUBLISHED = {
    id: 'act-1',
    course_id: 'course-1',
    points: 20,
    status: 'published',
    kind: 'offline',
  };

  function markTables(
    over: { activity?: any; rosterRow?: any; existing?: any } = {},
  ): (prisma: MockPrisma) => void {
    return (p) => {
      p.activity.findUnique.mockResolvedValue(over.activity ?? PUBLISHED);
      p.course_student.findFirst.mockResolvedValue(
        'rosterRow' in over ? over.rosterRow : { student_id: 'stu-1' },
      );
      p.submission.findFirst.mockResolvedValue(over.existing ?? null);
      p.submission.upsert.mockImplementation(
        async ({ create, update }: any) => ({
          id: 'sub-1',
          student_id: 'stu-1',
          excused: false,
          ...(over.existing ? update : create),
        }),
      );
    };
  }

  /** What the upsert writes: the insert for a new row, else the update. */
  function written(prisma: MockPrisma, existing = false) {
    const args = prisma.submission.upsert.mock.calls[0][0];
    return existing ? args.update : args.create;
  }

  test('marking offline work creates the submission as graded', async () => {
    const { service, prisma } = build(markTables());

    const result = await service.grade('user-1', 'act-1', 'stu-1', {
      score: 15,
      feedback: 'Well done',
    });

    expect(prisma.submission.upsert.mock.calls[0][0].where).toEqual({
      activity_id_student_id: { activity_id: 'act-1', student_id: 'stu-1' },
    });
    expect(written(prisma)).toMatchObject({
      activity_id: 'act-1',
      student_id: 'stu-1',
      status: 'graded',
      score: 15,
      feedback: 'Well done',
      graded_by: 'user-1',
    });
    expect(result.score).toBe(15);
    expect(prisma.grade.upsert).not.toHaveBeenCalled();
    expect(prisma.grade.create).not.toHaveBeenCalled();
  });

  test('a bare score clears the rubric levels from an earlier rubric mark', async () => {
    const { service, prisma } = build(
      markTables({ existing: { id: 'sub-1' } }),
    );

    await service.grade('user-1', 'act-1', 'stu-1', { score: 12 });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.rubric_assessment.deleteMany.mock.calls[0][0].where).toEqual({
      submission_id: 'sub-1',
    });
  });

  test('the score is checked against the points under a share lock', async () => {
    const { service, prisma } = build((p) => {
      markTables()(p);
      // Lowered to 10 since the activity was first read at 20.
      p.$queryRaw.mockResolvedValue([{ points: 10 }]);
    });

    const err = await service
      .grade('user-1', 'act-1', 'stu-1', { score: 15 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe('Score must be between 0 and 10');
    const lockSql = (prisma.$queryRaw.mock.calls[0][0] as string[]).join('?');
    expect(lockSql).toContain('grading.activity');
    expect(lockSql).toContain('for share');
    expect(prisma.submission.upsert).not.toHaveBeenCalled();
    expect(prisma.rubric_assessment.deleteMany).not.toHaveBeenCalled();
  });

  test('a TA can mark', async () => {
    const { service } = build(markTables(), {}, stubAccess({ staff: 'ta' }));
    const result = await service.grade('user-1', 'act-1', 'stu-1', {
      score: 1,
    });
    expect(result.status).toBe('graded');
  });

  test('a teacher can mark after the due date', async () => {
    const { service } = build(
      markTables({
        activity: {
          ...PUBLISHED,
          due_at: new Date('2026-10-01T12:00:00.000Z'),
        },
      }),
    );

    const result = await service.grade('user-1', 'act-1', 'stu-1', {
      score: 18,
    });
    expect(result.status).toBe('graded');
    expect(result.score).toBe(18);
  });

  test('refuses a student who is not on the roster', async () => {
    const { service } = build(markTables({ rosterRow: null }));
    await expect(
      service.grade('user-1', 'act-1', 'stu-9', { score: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('refuses a score above the points', async () => {
    const { service } = build(markTables());
    await expect(
      service.grade('user-1', 'act-1', 'stu-1', { score: 21 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('refuses to mark a draft', async () => {
    const { service } = build(
      markTables({ activity: { ...PUBLISHED, status: 'draft' } }),
    );
    await expect(
      service.grade('user-1', 'act-1', 'stu-1', { score: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  test('excusing a student with no submission creates a graded, excused row', async () => {
    const { service, prisma } = build(markTables());

    const result = await service.excuse('user-1', 'act-1', 'stu-1', {
      excused: true,
      reason: ' Absent ',
    });

    expect(written(prisma)).toMatchObject({
      excused: true,
      excused_reason: 'Absent',
      status: 'graded',
    });
    expect(result.excused).toBe(true);
  });

  test('excusing existing work keeps its status and score', async () => {
    const { service, prisma } = build(
      markTables({ existing: { id: 'sub-1' } }),
    );

    await service.excuse('user-1', 'act-1', 'stu-1', { excused: true });

    const update = written(prisma, true);
    expect(update).not.toHaveProperty('status');
    expect(update).not.toHaveProperty('score');
  });

  test('lifting an excuse clears the reason', async () => {
    const { service, prisma } = build(
      markTables({ existing: { id: 'sub-1' } }),
    );

    await service.excuse('user-1', 'act-1', 'stu-1', {
      excused: false,
      reason: 'ignored',
    });

    const update = written(prisma, true);
    expect(update.excused).toBe(false);
    expect(update.excused_reason).toBeNull();
  });

  test('the teacher list is the roster plus anyone with a submission', async () => {
    const { service, prisma } = build((p) => {
      p.activity.findUnique.mockResolvedValue(PUBLISHED);
      p.course_student.findMany.mockResolvedValue([
        { student_id: 'stu-1', status: 'active' },
        { student_id: 'stu-2', status: 'dropped' },
        { student_id: 'stu-3', status: 'dropped' },
      ]);
      p.submission.findMany.mockResolvedValue([
        {
          id: 'sub-2',
          student_id: 'stu-2',
          status: 'graded',
          score: new Prisma.Decimal(10),
          excused: true,
          excused_reason: 'Ill',
        },
      ]);
      // The mock ignores the filter; return what the real one would.
      p.student.findMany.mockResolvedValue([
        { id: 'stu-1', first_name: 'Ann', last_name: 'A' },
        { id: 'stu-2', first_name: 'Bob', last_name: 'B' },
      ]);
    });

    const list = await service.listForTeacher('user-1', 'act-1');
    expect(prisma.student.findMany.mock.calls[0][0].where.id.in.sort()).toEqual(
      ['stu-1', 'stu-2'],
    );
    expect(list.map((r) => r.studentId)).toEqual(['stu-1', 'stu-2']);
    expect(list[1].enrollmentStatus).toBe('dropped');
    expect(list[1].submission!.excused).toBe(true);
    expect(list[1].submission!.excusedReason).toBe('Ill');
    expect(list[1].submission!.score).toBe(10);
  });

  describe('quiz attempts, draft saves, and timers', () => {
    test('startQuizAttempt starts an attempt and calculates expiresAt from time limit', async () => {
      const { service, prisma } = build((p) => {
        studentTables({
          activity: {
            ...ACTIVITY,
            kind: 'quiz',
            time_limit_minutes: 30,
            max_attempts: 2,
          },
          submission: { id: 'sub-1', status: 'draft', attempt_count: 0 },
        })(p);
        p.$queryRaw.mockResolvedValue([
          {
            attempt_count: 0,
            graded_by: null,
            quiz_started_at: null,
            quiz_expires_at: null,
          },
        ]);
      });

      const res = await service.startQuizAttempt('stu-1', 'act-1');
      expect(res.startedAt).toBeDefined();
      expect(res.expiresAt).toBeDefined();
      const duration = Date.parse(res.expiresAt!) - Date.parse(res.startedAt);
      expect(duration).toBe(30 * 60 * 1000);
      expect(prisma.quiz_answer.deleteMany).toHaveBeenCalled();
      expect(prisma.submission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: expect.objectContaining({
            quiz_started_at: expect.any(Date),
            quiz_expires_at: expect.any(Date),
          }),
        }),
      );
    });

    test('startQuizAttempt on untimed quiz leaves expiresAt null', async () => {
      const { service, prisma } = build((p) => {
        studentTables({
          activity: { ...ACTIVITY, kind: 'quiz', time_limit_minutes: null },
          submission: { id: 'sub-1', status: 'draft', attempt_count: 0 },
        })(p);
        p.$queryRaw.mockResolvedValue([
          {
            attempt_count: 0,
            graded_by: null,
            quiz_started_at: null,
            quiz_expires_at: null,
          },
        ]);
      });

      const res = await service.startQuizAttempt('stu-1', 'act-1');
      expect(res.startedAt).toBeDefined();
      expect(res.expiresAt).toBeNull();
      expect(prisma.submission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            quiz_expires_at: null,
          }),
        }),
      );
    });

    test('startQuizAttempt on in-progress attempt returns existing timestamps without resetting', async () => {
      const started = new Date(Date.now() - 60_000);
      const expires = new Date(Date.now() + 600_000);
      const { service, prisma } = build((p) => {
        studentTables({
          activity: { ...ACTIVITY, kind: 'quiz', time_limit_minutes: 30 },
          submission: {
            id: 'sub-1',
            status: 'draft',
            quiz_started_at: started,
            quiz_expires_at: expires,
          },
        })(p);
        p.$queryRaw.mockResolvedValue([
          {
            attempt_count: 0,
            graded_by: null,
            quiz_started_at: started,
            quiz_expires_at: expires,
          },
        ]);
      });

      const res = await service.startQuizAttempt('stu-1', 'act-1');
      expect(res.startedAt).toBe(started.toISOString());
      expect(res.expiresAt).toBe(expires.toISOString());
      expect(prisma.submission.update).not.toHaveBeenCalled();
      expect(prisma.quiz_answer.deleteMany).not.toHaveBeenCalled();
    });

    test('startQuizAttempt refuses closed quiz or exhausted attempts', async () => {
      const { service: closedService } = build((p) => {
        studentTables({
          activity: { ...ACTIVITY, kind: 'quiz', status: 'closed' },
        })(p);
      });
      await expect(
        closedService.startQuizAttempt('stu-1', 'act-1'),
      ).rejects.toThrow('This quiz is closed');

      const { service: exhaustedService } = build((p) => {
        studentTables({
          activity: { ...ACTIVITY, kind: 'quiz', max_attempts: 1 },
        })(p);
        p.$queryRaw.mockResolvedValue([
          {
            attempt_count: 1,
            graded_by: null,
            quiz_started_at: null,
            quiz_expires_at: null,
          },
        ]);
      });
      await expect(
        exhaustedService.startQuizAttempt('stu-1', 'act-1'),
      ).rejects.toThrow('You have no attempts left');
    });

    test('saveQuizAnswers requires started attempt and persists accepted answers', async () => {
      const { service: unstartedService } = build((p) => {
        studentTables({
          activity: { ...ACTIVITY, kind: 'quiz' },
        })(p);
        p.$queryRaw.mockResolvedValue([
          { quiz_started_at: null, quiz_expires_at: null },
        ]);
      });
      await expect(
        unstartedService.saveQuizAnswers('stu-1', 'act-1', []),
      ).rejects.toThrow('Start the quiz before saving answers');

      const { service, prisma } = build((p) => {
        studentTables({
          activity: { ...ACTIVITY, kind: 'quiz' },
        })(p);
        p.$queryRaw.mockResolvedValue([
          {
            quiz_started_at: new Date('2026-11-05T10:00:00Z'),
            quiz_expires_at: new Date(Date.now() + 600_000),
          },
        ]);
        p.quiz_question.findMany.mockResolvedValue([
          { id: 'q-1', kind: 'multiple_choice' },
          { id: 'q-2', kind: 'short_answer' },
        ]);
        p.quiz_option.findMany.mockResolvedValue([
          { id: 'opt-1', question_id: 'q-1' },
        ]);
      });

      const res = await service.saveQuizAnswers('stu-1', 'act-1', [
        { questionId: 'q-1', optionId: 'opt-1' },
        { questionId: 'q-2', text: '  my answer  ' },
        { questionId: 'unknown', text: 'ignored' },
      ]);

      expect(res.savedAt).toBeDefined();
      expect(prisma.quiz_answer.deleteMany).toHaveBeenCalledWith({
        where: {
          submission_id: 'sub-1',
          quiz_question: { activity_id: 'act-1' },
        },
      });
      expect(prisma.quiz_answer.createMany).toHaveBeenCalledWith({
        data: [
          {
            submission_id: 'sub-1',
            question_id: 'q-1',
            option_id: 'opt-1',
            text_answer: null,
          },
          {
            submission_id: 'sub-1',
            question_id: 'q-2',
            option_id: null,
            text_answer: 'my answer',
          },
        ],
      });
    });

    test('saveQuizAnswers refuses save when time has expired', async () => {
      const { service } = build((p) => {
        studentTables({
          activity: { ...ACTIVITY, kind: 'quiz' },
        })(p);
        p.$queryRaw.mockResolvedValue([
          {
            quiz_started_at: new Date('2026-11-05T09:00:00Z'),
            quiz_expires_at: new Date('2026-11-05T09:30:00Z'),
          },
        ]);
      });

      await expect(
        service.saveQuizAnswers('stu-1', 'act-1', []),
      ).rejects.toThrow('Time is up; your saved answers were submitted');
    });

    test('submitQuiz ignores client answers when time expired and submits saved answers', async () => {
      const { service, prisma } = build((p) => {
        studentTables({
          activity: { ...ACTIVITY, kind: 'quiz', lockdown_browser: true },
          submission: {
            id: 'sub-1',
            status: 'draft',
            quiz_started_at: new Date('2026-11-05T09:00:00Z'),
          },
        })(p);
        p.$queryRaw.mockImplementation(async (strings: string[]) => {
          if (strings.join('?').includes('submit_quiz')) {
            return [
              {
                score: new Prisma.Decimal(10),
                points: new Prisma.Decimal(10),
                attempts_used: 1,
              },
            ];
          }
          return [
            {
              attempt_count: 0,
              graded_by: null,
              quiz_started_at: new Date('2026-11-05T09:00:00Z'),
              expired: true,
            },
          ];
        });
      });

      const res = await service.submitQuiz('stu-1', 'act-1', [
        { questionId: 'q-1', optionId: 'opt-1' },
      ]);
      expect(res).toEqual({ score: 10, points: 10 });
      // When expired, client answers are not written.
      expect(prisma.quiz_answer.deleteMany).not.toHaveBeenCalled();
      expect(prisma.quiz_answer.createMany).not.toHaveBeenCalled();
    });

    test('validQuizAnswers caches question structure and avoids repeat database lookups', async () => {
      const cache = createMockCacheService();
      const { service, prisma } = build(
        (p) => {
          studentTables({
            activity: { ...ACTIVITY, kind: 'quiz' },
          })(p);
          p.$queryRaw.mockResolvedValue([
            {
              quiz_started_at: new Date('2026-11-05T10:00:00Z'),
              quiz_expires_at: new Date(Date.now() + 600_000),
            },
          ]);
          p.quiz_question.findMany.mockResolvedValue([
            { id: 'q-1', kind: 'multiple_choice' },
          ]);
          p.quiz_option.findMany.mockResolvedValue([
            { id: 'opt-1', question_id: 'q-1' },
          ]);
        },
        {},
        stubAccess(),
        undefined,
        cache,
      );

      // First call fetches from database and caches
      await service.saveQuizAnswers('stu-1', 'act-1', [
        { questionId: 'q-1', optionId: 'opt-1' },
      ]);
      expect(prisma.quiz_question.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.quiz_option.findMany).toHaveBeenCalledTimes(1);

      // Second call uses cached quiz structure without querying quiz_question/option
      await service.saveQuizAnswers('stu-1', 'act-1', [
        { questionId: 'q-1', optionId: 'opt-1' },
      ]);
      expect(prisma.quiz_question.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.quiz_option.findMany).toHaveBeenCalledTimes(1);
    });

    test('updateQuizPresence tracks away state and increments tab switch count in DB', async () => {
      const cache = createMockCacheService();
      const { service, prisma } = build(
        (p) => {
          studentTables({
            activity: { ...ACTIVITY, kind: 'quiz', lockdown_browser: true },
            submission: {
              id: 'sub-1',
              status: 'draft',
              quiz_started_at: new Date(Date.now() - 10_000),
              quiz_expires_at: new Date(Date.now() + 600_000),
              is_away: false,
              tab_switch_count: 1,
            },
          })(p);
        },
        {},
        stubAccess(),
        undefined,
        cache,
      );

      // Student leaves tab: isAway = true
      await service.updateQuizPresence('stu-1', 'act-1', {
        isAway: true,
        reason: 'tab_hidden',
      });
      expect(prisma.submission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: expect.objectContaining({
            is_away: true,
            tab_switch_count: { increment: 1 },
          }),
        }),
      );

      // Cached presence was stored
      const presence = await cache.get('quiz:presence:act-1:stu-1');
      expect(presence).toMatchObject({
        isAway: true,
        reason: 'tab_hidden',
      });
    });

    test('updateQuizPresence counts a departure once, not every away ping', async () => {
      const { service, prisma } = build(
        studentTables({
          activity: { ...ACTIVITY, kind: 'quiz', lockdown_browser: true },
          submission: {
            id: 'sub-1',
            status: 'draft',
            quiz_started_at: new Date(Date.now() - 10_000),
            quiz_expires_at: new Date(Date.now() + 600_000),
            is_away: true,
            tab_switch_count: 1,
          },
        }),
        {},
        stubAccess(),
        undefined,
        createMockCacheService(),
      );

      await service.updateQuizPresence('stu-1', 'act-1', {
        isAway: true,
        reason: 'tab_hidden',
      });
      const data = prisma.submission.update.mock.calls[0][0].data;
      expect(data.is_away).toBe(true);
      expect(data.tab_switch_count).toBeUndefined();
      expect(data.last_away_at).toBeUndefined();
    });

    test('updateQuizPresence ignores a quiz without lockdown', async () => {
      const { service, prisma } = build(
        studentTables({
          activity: { ...ACTIVITY, kind: 'quiz', lockdown_browser: false },
          submission: {
            id: 'sub-1',
            status: 'draft',
            quiz_started_at: new Date(Date.now() - 10_000),
            quiz_expires_at: new Date(Date.now() + 600_000),
            is_away: false,
            tab_switch_count: 0,
          },
        }),
        {},
        stubAccess(),
        undefined,
        createMockCacheService(),
      );

      expect(
        await service.updateQuizPresence('stu-1', 'act-1', { isAway: true }),
      ).toEqual({ ok: true });
      expect(prisma.submission.update).not.toHaveBeenCalled();
    });

    test('listForTeacher never flags away on a quiz without lockdown', async () => {
      const { service } = build(
        (p) => {
          p.activity.findUnique.mockResolvedValue({
            ...PUBLISHED,
            kind: 'quiz',
            lockdown_browser: false,
          });
          p.course_student.findMany.mockResolvedValue([
            { student_id: 'stu-1', status: 'active' },
          ]);
          p.submission.findMany.mockResolvedValue([
            {
              id: 'sub-1',
              student_id: 'stu-1',
              status: 'draft',
              score: null,
              attempt_count: 0,
              quiz_started_at: new Date(Date.now() - 120_000),
              quiz_expires_at: new Date(Date.now() + 600_000),
              is_away: false,
              tab_switch_count: 0,
              last_away_at: null,
              excused: false,
            },
          ]);
          p.student.findMany.mockResolvedValue([
            { id: 'stu-1', first_name: 'Eve', last_name: 'Tester' },
          ]);
        },
        {},
        stubAccess(),
        undefined,
        createMockCacheService(),
      );

      const rows = await service.listForTeacher('user-1', 'act-1');
      expect(rows[0].submission?.isActiveAttempt).toBe(true);
      expect(rows[0].submission?.isAway).toBe(false);
      expect(rows[0].submission?.awayReason).toBeNull();
    });

    test('listForTeacher reports live proctoring and tab switch counts', async () => {
      const cache = createMockCacheService();
      await cache.set(
        'quiz:presence:act-1:stu-1',
        {
          isAway: true,
          reason: 'fullscreen_exit',
          lastPingAt: new Date().toISOString(),
        },
        35,
      );

      const { service } = build(
        (p) => {
          p.activity.findUnique.mockResolvedValue({
            ...PUBLISHED,
            kind: 'quiz',
            lockdown_browser: true,
          });
          p.course_student.findMany.mockResolvedValue([
            { student_id: 'stu-1', status: 'active' },
          ]);
          p.submission.findMany.mockResolvedValue([
            {
              id: 'sub-1',
              student_id: 'stu-1',
              status: 'draft',
              score: null,
              attempt_count: 0,
              quiz_started_at: new Date(Date.now() - 30_000),
              quiz_expires_at: new Date(Date.now() + 600_000),
              is_away: true,
              tab_switch_count: 2,
              last_away_at: new Date(),
              excused: false,
            },
          ]);
          p.student.findMany.mockResolvedValue([
            { id: 'stu-1', first_name: 'Eve', last_name: 'Tester' },
          ]);
        },
        {},
        stubAccess(),
        undefined,
        cache,
      );

      const rows = await service.listForTeacher('user-1', 'act-1');
      expect(rows).toHaveLength(1);
      expect(rows[0].submission?.isActiveAttempt).toBe(true);
      expect(rows[0].submission?.isAway).toBe(true);
      expect(rows[0].submission?.awayReason).toBe('fullscreen_exit');
      expect(rows[0].submission?.tabSwitchCount).toBe(2);
    });
  });
});
