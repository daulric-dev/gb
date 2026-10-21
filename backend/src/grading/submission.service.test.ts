import { describe, test, expect } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SubmissionService } from './submission.service';
import { createRoutingSupabase } from '@/test/mocks';

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
  tables: Record<string, any>,
  files: Partial<Record<string, any>> = {},
  access: ReturnType<typeof stubAccess> = stubAccess(),
) {
  const supabase = createRoutingSupabase({ tables });
  const service = new SubmissionService(
    supabase as any,
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
  return { service, supabase };
}

/** The lookups every student-side call makes before it does anything. */
function studentTables(over: Record<string, any> = {}) {
  return {
    'grading.activity': { data: { ...ACTIVITY }, error: null },
    'student.student': { data: { user_profile_id: 'user-1' }, error: null },
    'grading.submission': {
      data: { id: 'sub-1', status: 'draft', file_id: null },
      error: null,
    },
    'file_manager.file': { data: [], error: null },
    ...over,
  };
}

describe('SubmissionService file handling', () => {
  test('attachFile stores the uploaded id on the draft', async () => {
    const { service, supabase } = build(studentTables());

    const result = await service.attachFile('stu-1', 'act-1', {} as any);

    expect(result).toEqual({ fileId: 'file-1', name: 'essay.pdf' });

    const update = supabase._calls.find(
      (c: any) => c.table === 'submission' && c.op === 'update',
    );
    if (!update) throw new Error('expected the draft to be updated');
    expect(update.payload.file_id).toBe('file-1');
    expect(update.filters.id).toBe('sub-1');
  });

  test('attachFile refuses an assignment that does not accept files', async () => {
    const { service } = build(
      studentTables({
        'grading.activity': {
          data: { ...ACTIVITY, allow_file: false },
          error: null,
        },
      }),
    );

    await expect(
      service.attachFile('stu-1', 'act-1', {} as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('attachFile refuses a quiz', async () => {
    const { service } = build(
      studentTables({
        'grading.activity': {
          data: { ...ACTIVITY, kind: 'quiz' },
          error: null,
        },
      }),
    );

    await expect(
      service.attachFile('stu-1', 'act-1', {} as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('attachFile refuses once the work is already handed in', async () => {
    const { service } = build(
      studentTables({
        'grading.submission': {
          data: { id: 'sub-1', status: 'submitted', file_id: 'file-0' },
          error: null,
        },
      }),
    );

    await expect(
      service.attachFile('stu-1', 'act-1', {} as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  test('submitting text keeps a file attached earlier', async () => {
    const { service, supabase } = build(
      studentTables({
        'grading.submission': (call: any) =>
          call.op === 'update'
            ? { data: { id: 'sub-1', status: 'submitted' }, error: null }
            : {
                data: { id: 'sub-1', status: 'draft', file_id: 'file-1' },
                error: null,
              },
      }),
    );

    await service.submitAssignment('stu-1', 'act-1', { textBody: 'My essay' });

    const update = supabase._calls.find(
      (c: any) => c.table === 'submission' && c.op === 'update',
    );
    if (!update) throw new Error('expected the submission to be updated');
    expect(update.payload.file_id).toBe('file-1');
    expect(update.payload.text_body).toBe('My essay');
  });

  test('a file alone is enough to hand in', async () => {
    const { service } = build(
      studentTables({
        'grading.activity': {
          data: { ...ACTIVITY, allow_text: false },
          error: null,
        },
        'grading.submission': (call: any) =>
          call.op === 'update'
            ? { data: { id: 'sub-1', status: 'submitted' }, error: null }
            : {
                data: { id: 'sub-1', status: 'draft', file_id: 'file-1' },
                error: null,
              },
      }),
    );

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
      {
        'grading.submission': {
          data: { id: 'sub-1', activity_id: 'act-1', file_id: 'file-1' },
          error: null,
        },
      },
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
      {
        'grading.submission': {
          data: { id: 'sub-1', activity_id: 'act-1', file_id: 'file-1' },
          error: null,
        },
      },
      {},
      stubAccess({ staff: 'ta' }),
    );

    const result = await service.readSubmissionFile('user-1', 'sub-1');
    expect(result.filename).toBe('essay.pdf');
  });

  test('there is nothing to read when no file was handed in', async () => {
    const { service } = build({
      'grading.submission': {
        data: { id: 'sub-1', activity_id: 'act-1', file_id: null },
        error: null,
      },
    });

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
      studentTables({
        'grading.activity': {
          data: { ...ACTIVITY, status: 'draft' },
          error: null,
        },
      }),
    );
    await expect(
      service.getForStudent('stu-1', 'act-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('offline work can be viewed but not handed in', async () => {
    const tables = studentTables({
      'grading.activity': {
        data: {
          ...ACTIVITY,
          kind: 'offline',
          allow_file: false,
          allow_text: false,
        },
        error: null,
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
        'grading.submission': {
          data: {
            id: 'sub-1',
            status: 'submitted',
            score: 12,
            feedback: 'half done',
            excused: false,
          },
          error: null,
        },
      }),
    );
    const view = await service.getForStudent('stu-1', 'act-1');
    expect(view.submission!.score).toBeNull();
    expect(view.submission!.feedback).toBeNull();
  });

  test('a quiz submission never writes grading.grade', async () => {
    const { service, supabase } = build(
      studentTables({
        'grading.activity': {
          data: { ...ACTIVITY, kind: 'quiz', max_attempts: null },
          error: null,
        },
        'grading.submission': {
          data: { id: 'sub-1', status: 'draft', attempt_count: 0 },
          error: null,
        },
        'grading.quiz_question': { data: [], error: null },
      }),
    );
    (supabase as any)._client.rpc = () =>
      Promise.resolve({ data: [{ score: 5, points: 20 }], error: null });

    const result = await service.submitQuiz('stu-1', 'act-1', []);
    expect(result).toEqual({ score: 5, points: 20 });
    expect(supabase._calls.some((c) => c.table === 'grade')).toBe(false);
  });

  test('the course list maps to the PortalCourseActivity contract', async () => {
    const { service } = build({
      'grading.activity': {
        data: [
          {
            ...ACTIVITY,
            status: 'published',
            assignment_group_id: null,
            published_at: '2026-09-01T00:00:00Z',
            omit_from_final_grade: true,
            created_at: '2026-09-01T00:00:00Z',
          },
        ],
        error: null,
      },
      'grading.submission': {
        data: [
          {
            activity_id: 'act-1',
            status: 'graded',
            score: 18,
            excused: false,
            feedback: 'Good',
            submitted_at: '2026-09-02T00:00:00Z',
            attempt_count: 0,
          },
        ],
        error: null,
      },
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
      submittedAt: '2026-09-02T00:00:00Z',
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

  function markTables(over: Record<string, any> = {}) {
    return {
      'grading.activity': { data: PUBLISHED, error: null },
      'course.course_student': { data: { student_id: 'stu-1' }, error: null },
      'grading.submission': (call: any) =>
        call.op === 'upsert'
          ? {
              data: {
                id: 'sub-1',
                student_id: 'stu-1',
                excused: false,
                ...call.payload,
              },
              error: null,
            }
          : { data: null, error: null },
      ...over,
    };
  }

  test('marking offline work creates the submission as graded', async () => {
    const { service, supabase } = build(markTables());

    const result = await service.grade('user-1', 'act-1', 'stu-1', {
      score: 15,
      feedback: 'Well done',
    });

    const upsert = supabase._calls.find((c) => c.op === 'upsert')!;
    expect(upsert.table).toBe('submission');
    expect(upsert.payload).toMatchObject({
      activity_id: 'act-1',
      student_id: 'stu-1',
      status: 'graded',
      score: 15,
      feedback: 'Well done',
      graded_by: 'user-1',
    });
    expect(result.score).toBe(15);
    expect(supabase._calls.some((c) => c.table === 'grade')).toBe(false);
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
      markTables({ 'course.course_student': { data: null, error: null } }),
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
      markTables({
        'grading.activity': {
          data: { ...PUBLISHED, status: 'draft' },
          error: null,
        },
      }),
    );
    await expect(
      service.grade('user-1', 'act-1', 'stu-1', { score: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  test('excusing a student with no submission creates a graded, excused row', async () => {
    const { service, supabase } = build(markTables());

    const result = await service.excuse('user-1', 'act-1', 'stu-1', {
      excused: true,
      reason: ' Absent ',
    });

    const upsert = supabase._calls.find((c) => c.op === 'upsert')!;
    expect(upsert.payload).toMatchObject({
      excused: true,
      excused_reason: 'Absent',
      status: 'graded',
    });
    expect(result.excused).toBe(true);
  });

  test('excusing existing work keeps its status and score', async () => {
    const { service, supabase } = build(
      markTables({
        'grading.submission': (call: any) =>
          call.op === 'upsert'
            ? {
                data: { id: 'sub-1', student_id: 'stu-1', ...call.payload },
                error: null,
              }
            : { data: { id: 'sub-1' }, error: null },
      }),
    );

    await service.excuse('user-1', 'act-1', 'stu-1', { excused: true });

    const upsert = supabase._calls.find((c) => c.op === 'upsert')!;
    expect(upsert.payload).not.toHaveProperty('status');
    expect(upsert.payload).not.toHaveProperty('score');
  });

  test('lifting an excuse clears the reason', async () => {
    const { service, supabase } = build(
      markTables({
        'grading.submission': (call: any) =>
          call.op === 'upsert'
            ? {
                data: { id: 'sub-1', student_id: 'stu-1', ...call.payload },
                error: null,
              }
            : { data: { id: 'sub-1' }, error: null },
      }),
    );

    await service.excuse('user-1', 'act-1', 'stu-1', {
      excused: false,
      reason: 'ignored',
    });

    const upsert = supabase._calls.find((c) => c.op === 'upsert')!;
    expect(upsert.payload.excused).toBe(false);
    expect(upsert.payload.excused_reason).toBeNull();
  });

  test('the teacher list is the roster plus anyone with a submission', async () => {
    const { service } = build({
      'grading.activity': { data: PUBLISHED, error: null },
      'course.course_student': {
        data: [
          { student_id: 'stu-1', status: 'active' },
          { student_id: 'stu-2', status: 'dropped' },
          { student_id: 'stu-3', status: 'dropped' },
        ],
        error: null,
      },
      'grading.submission': {
        data: [
          {
            id: 'sub-2',
            student_id: 'stu-2',
            status: 'graded',
            score: 10,
            excused: true,
            excused_reason: 'Ill',
          },
        ],
        error: null,
      },
      // The mock ignores .in(); return what the real filter would.
      'student.student': {
        data: [
          { id: 'stu-1', first_name: 'Ann', last_name: 'A' },
          { id: 'stu-2', first_name: 'Bob', last_name: 'B' },
        ],
        error: null,
      },
      'file_manager.file': { data: [], error: null },
    });

    const list = await service.listForTeacher('user-1', 'act-1');
    expect(list.map((r) => r.studentId)).toEqual(['stu-1', 'stu-2']);
    expect(list[1].enrollmentStatus).toBe('dropped');
    expect(list[1].submission!.excused).toBe(true);
    expect(list[1].submission!.excusedReason).toBe('Ill');
  });
});
