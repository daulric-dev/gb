import { describe, test, expect } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { SubmissionService } from './submission.service';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

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
) {
  const prisma = createMockPrisma();
  setup(prisma);
  const service = new SubmissionService(
    prisma as any,
    {
      uploadManual: () =>
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
  test('attachFile stores the uploaded id on the draft', async () => {
    const { service, prisma } = build(studentTables());

    const result = await service.attachFile('stu-1', 'act-1', {} as any);

    expect(result).toEqual({ fileId: 'file-1', name: 'essay.pdf' });

    const update = prisma.submission.updateMany.mock.calls[0]?.[0];
    if (!update) throw new Error('expected the draft to be updated');
    expect(update.data.file_id).toBe('file-1');
    expect(update.where.id).toBe('sub-1');
  });

  test('attachFile refuses an assignment that does not accept files', async () => {
    const { service } = build(
      studentTables({ activity: { ...ACTIVITY, allow_file: false } }),
    );

    await expect(
      service.attachFile('stu-1', 'act-1', {} as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('attachFile refuses a quiz', async () => {
    const { service } = build(
      studentTables({ activity: { ...ACTIVITY, kind: 'quiz' } }),
    );

    await expect(
      service.attachFile('stu-1', 'act-1', {} as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('attachFile refuses once the work is already handed in', async () => {
    const { service } = build(
      studentTables({
        submission: { id: 'sub-1', status: 'submitted', file_id: 'file-0' },
      }),
    );

    await expect(
      service.attachFile('stu-1', 'act-1', {} as any),
    ).rejects.toBeInstanceOf(ConflictException);
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
      service.attachFile('stu-1', 'act-1', {} as any),
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
        submission: { id: 'sub-1', status: 'draft', attempt_count: 0 },
      })(p);
      p.quiz_question.findMany.mockResolvedValue([]);
      p.$queryRaw.mockResolvedValue([
        { score: new Prisma.Decimal(5), points: new Prisma.Decimal(20) },
      ]);
    });

    const result = await service.submitQuiz('stu-1', 'act-1', []);
    expect(result).toEqual({ score: 5, points: 20 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
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
    ]) {
      const { service } = build((p) => {
        studentTables({
          activity: { ...ACTIVITY, kind: 'quiz', max_attempts: null },
          submission: { id: 'sub-1', status: 'draft', attempt_count: 0 },
        })(p);
        p.$queryRaw.mockRejectedValue(raised(message));
      });
      const err = await service.submitQuiz('stu-1', 'act-1', []).catch((e) => e);
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
        submission: { id: 'sub-1', status: 'draft', attempt_count: 0 },
      })(p);
      p.quiz_question.findMany.mockResolvedValue([]);
      p.$queryRaw.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Raw query failed: already_marked',
          {
            code: 'P2010',
            clientVersion: 'test',
            meta: { code: 'P0025', message: 'already_marked' },
          },
        ),
      );
    });
    const err = await service.submitQuiz('stu-1', 'act-1', []).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
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
      p.submission.upsert.mockImplementation(async ({ create, update }: any) => ({
        id: 'sub-1',
        student_id: 'stu-1',
        excused: false,
        ...(over.existing ? update : create),
      }));
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

  test('a TA can mark', async () => {
    const { service } = build(markTables(), {}, stubAccess({ staff: 'ta' }));
    const result = await service.grade('user-1', 'act-1', 'stu-1', {
      score: 1,
    });
    expect(result.status).toBe('graded');
  });

  test('refuses a student who is not on the roster', async () => {
    const { service } = build(
      markTables({ rosterRow: null }),
    );
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
});
