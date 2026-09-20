import { describe, test, expect } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SubmissionService } from './submission.service';
import { createRoutingSupabase, createMockCacheService } from '@/test/mocks';

/**
 * File handling on submissions.
 *
 * The student is the file's owner but holds no catalog permissions, so the
 * portal endpoint is their only way to upload; the teacher is not the owner
 * and has no share, so their read is authorised by owning the class. Both
 * sides sit outside the file manager's own rules, which is why they are
 * tested here.
 */

const ACTIVITY = {
  id: 'act-1',
  student_group_id: 'class-1',
  subject_id: 'sub-1',
  kind: 'assignment',
  title: 'Essay',
  instructions: null,
  points: 20,
  due_at: null,
  status: 'published',
  allow_file: true,
  allow_text: true,
};

function build(
  tables: Record<string, any>,
  files: Partial<Record<string, any>> = {},
) {
  const supabase = createRoutingSupabase({ tables });
  const service = new SubmissionService(
    supabase as any,
    createMockCacheService() as any,
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
  );
  return { service, supabase };
}

/** The lookups every student-side call makes before it does anything. */
function studentTables(over: Record<string, any> = {}) {
  return {
    'grading.activity': { data: { ...ACTIVITY }, error: null },
    'student.student_group_enrollment': {
      data: { student_id: 'stu-1' },
      error: null,
    },
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

  test('a teacher outside the school cannot read the file', async () => {
    let read = false;
    const { service } = build(
      {
        'grading.submission': {
          data: { id: 'sub-1', activity_id: 'act-1', file_id: 'file-1' },
          error: null,
        },
        'grading.activity': {
          data: { student_group_id: 'class-1' },
          error: null,
        },
        // The class belongs to another school than the caller's profile.
        'public.user_profile': { data: { school_id: 'school-2' }, error: null },
        'public.student_group': {
          data: { id: 'class-1', academic_year: { school_id: 'school-1' } },
          error: null,
        },
      },
      {
        readContentForAuthorisedCaller: () => {
          read = true;
          return Promise.resolve({} as any);
        },
      },
    );

    await expect(
      service.readSubmissionFile('user-9', 'sub-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(read).toBe(false);
  });

  test('the class teacher reads the bytes', async () => {
    const { service } = build({
      'grading.submission': {
        data: { id: 'sub-1', activity_id: 'act-1', file_id: 'file-1' },
        error: null,
      },
      'grading.activity': {
        data: { student_group_id: 'class-1' },
        error: null,
      },
      'public.user_profile': { data: { school_id: 'school-1' }, error: null },
      'public.student_group': {
        data: { id: 'class-1', academic_year: { school_id: 'school-1' } },
        error: null,
      },
    });

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
