import { describe, test, expect } from 'bun:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { createRoutingSupabase, createMockCacheService } from '@/test/mocks';

/**
 * Excluding one student's mark.
 *
 * The activity-wide toggle drops every mark on a piece of work; this drops
 * one, for the student who was absent or sat a makeup. It authorises by the
 * class rather than by a subject assignment, which is what separates it from
 * `PATCH /grades/:id/exclude`, so the checks around it are worth pinning.
 */

const ACTIVITY = {
  id: 'act-1',
  student_group_id: 'class-1',
  subject_id: 'sub-1',
  term_id: 'term-1',
  grading_group_id: null,
  assessment_id: 'assess-1',
  kind: 'assignment',
  title: 'Essay',
  instructions: null,
  points: 20,
  due_at: null,
  status: 'published',
  published_at: '2026-09-01T00:00:00Z',
  allow_file: true,
  allow_text: true,
  max_attempts: 0,
  created_by: 'user-1',
  created_at: '2026-09-01T00:00:00Z',
};

function build(over: Record<string, any> = {}) {
  const supabase = createRoutingSupabase({
    tables: {
      // requireActivity -> requireClass -> requireSchool
      'public.user_profile': { data: { school_id: 'school-1' }, error: null },
      'public.student_group': {
        data: { id: 'class-1', academic_year: { school_id: 'school-1' } },
        error: null,
      },
      'grading.activity': { data: { ...ACTIVITY }, error: null },
      'grading.grade': { data: { id: 'grade-1' }, error: null },
      ...over,
    },
  });
  const service = new ActivityService(
    supabase as any,
    createMockCacheService() as any,
  );
  return { service, supabase };
}

describe('ActivityService.setStudentGradeExcluded', () => {
  test('refuses while the activity is still unpublished', async () => {
    const { service } = build({
      'grading.activity': {
        data: { ...ACTIVITY, assessment_id: null, status: 'draft' },
        error: null,
      },
    });

    await expect(
      service.setStudentGradeExcluded('user-1', 'act-1', 'stu-1', true),
    ).rejects.toThrow(ConflictException);
  });

  test('refuses when the student has no mark yet', async () => {
    const { service } = build({ 'grading.grade': { data: null, error: null } });

    await expect(
      service.setStudentGradeExcluded('user-1', 'act-1', 'stu-1', true),
    ).rejects.toThrow(NotFoundException);
  });

  test("refuses an activity outside the caller's school", async () => {
    const { service } = build({
      'public.student_group': {
        data: { id: 'class-1', academic_year: { school_id: 'other-school' } },
        error: null,
      },
    });

    await expect(
      service.setStudentGradeExcluded('user-1', 'act-1', 'stu-1', true),
    ).rejects.toThrow(NotFoundException);
  });

  test('excludes the mark and records the reason', async () => {
    const { service, supabase } = build();

    const result = await service.setStudentGradeExcluded(
      'user-1',
      'act-1',
      'stu-1',
      true,
      '  Absent, sat the makeup  ',
    );

    expect(result).toEqual({
      studentId: 'stu-1',
      gradeId: 'grade-1',
      isExcluded: true,
      exclusionReason: 'Absent, sat the makeup',
    });

    const update = supabase._calls.find(
      (c: any) => c.table === 'grade' && c.op === 'update',
    );
    expect(update).toBeDefined();
    expect(update!.payload).toMatchObject({
      is_excluded: true,
      exclusion_reason: 'Absent, sat the makeup',
      updated_by: 'user-1',
    });
  });

  test('looks the grade up by assessment as well as student', async () => {
    const { service, supabase } = build();

    await service.setStudentGradeExcluded('user-1', 'act-1', 'stu-1', true);

    // Student id alone would reach that student's grade on someone else's
    // assessment, which this activity has no business touching.
    const lookup = supabase._calls.find(
      (c: any) => c.table === 'grade' && c.op === 'select',
    );
    expect(lookup).toBeDefined();
    expect(lookup!.filters).toMatchObject({
      assessment_id: 'assess-1',
      student_id: 'stu-1',
    });
  });

  test('clears the reason when the mark goes back in', async () => {
    const { service, supabase } = build();

    const result = await service.setStudentGradeExcluded(
      'user-1',
      'act-1',
      'stu-1',
      false,
      'ignored',
    );

    expect(result.exclusionReason).toBeNull();

    const update = supabase._calls.find(
      (c: any) => c.table === 'grade' && c.op === 'update',
    );
    expect(update).toBeDefined();
    expect(update!.payload).toMatchObject({
      is_excluded: false,
      exclusion_reason: null,
    });
  });

  test('a blank reason is stored as no reason', async () => {
    const { service, supabase } = build();

    await service.setStudentGradeExcluded(
      'user-1',
      'act-1',
      'stu-1',
      true,
      '   ',
    );

    const update = supabase._calls.find(
      (c: any) => c.table === 'grade' && c.op === 'update',
    );
    expect(update).toBeDefined();
    expect(update!.payload.exclusion_reason).toBeNull();
  });
});
