import { describe, test, expect } from 'bun:test';
import { CalculationService } from './calculation.service';
import { createRoutingSupabase, createMockCacheService } from '@/test/mocks';
import { WeightedContinuousService } from './grading-systems/weighted-continuous/weighted-continuous.service';

/**
 * A mark must reach the class summary whether or not anyone filled in the
 * student's subject profile.
 *
 * The profile records what a student is *meant* to take and is maintained by
 * hand, so treating it as the only source of subjects silently hid real marks:
 * a quiz could be sat, auto-graded and written to the gradebook, and the
 * summary would still say "no grades recorded".
 */

const CLASS_ID = 'class-1';
const TERM_ID = 'term-1';
const STUDENT_ID = 'stu-1';
const SUBJECT_ID = 'sub-1';
const ASSESSMENT_ID = 'ass-1';

function build(subjectProfiles: any[]) {
  const supabase = createRoutingSupabase({
    tables: {
      'student.student_group_enrollment': {
        data: [{ student_id: STUDENT_ID }],
        error: null,
      },
      'public.student_group': {
        data: { academic_year_id: 'year-1' },
        error: null,
      },
      'student.student': {
        data: [{ id: STUDENT_ID, first_name: 'Ada', last_name: 'Byron' }],
        error: null,
      },
      'public.term': {
        data: { coursework_weight: 40, exam_weight: 60 },
        error: null,
      },
      'student.student_subject_profile': { data: subjectProfiles, error: null },
      'public.subject': {
        data: [
          {
            id: SUBJECT_ID,
            name: 'Maths',
            code: 'MTH',
            is_graded: true,
            sort_order: 0,
          },
        ],
        error: null,
      },
      'grading.assessment': {
        data: [
          {
            id: ASSESSMENT_ID,
            title: 'Quiz 1',
            assessment_type: 'coursework',
            grading_group_id: null,
            max_score: 100,
            weight: 1,
            is_excluded: false,
            sort_order: 0,
            subject_id: SUBJECT_ID,
            term_id: TERM_ID,
          },
        ],
        error: null,
      },
      'grading.grade': {
        data: [
          {
            id: 'g1',
            assessment_id: ASSESSMENT_ID,
            student_id: STUDENT_ID,
            score: 100,
            is_excluded: false,
            exclusion_reason: null,
          },
        ],
        error: null,
      },
      'public.academic_year': {
        data: { grading_model: 'weighted_continuous' },
        error: null,
      },
    },
    rpc: {
      resolve_grading_groups: {
        data: [
          {
            id: 'grp-1',
            name: 'Coursework',
            weight: 40,
            sort_order: 0,
            is_exam: false,
            is_class_specific: false,
          },
          {
            id: 'grp-2',
            name: 'Exam',
            weight: 60,
            sort_order: 1,
            is_exam: true,
            is_class_specific: false,
          },
        ],
        error: null,
      },
    },
  });

  const strategy = new WeightedContinuousService();

  return new CalculationService(
    supabase as any,
    createMockCacheService() as any,
    { getStrategy: () => strategy } as any,
  );
}

describe('class summary', () => {
  test('a graded subject appears even with no subject profile', async () => {
    const service = build([]);

    const rows = await service.calculateClassTermResults(TERM_ID, CLASS_ID);

    expect(rows).toHaveLength(1);
    const maths = rows[0].subjects.find((s: any) => s.subjectId === SUBJECT_ID);
    if (!maths) throw new Error('the graded subject is missing');
    expect(maths.gradeCount).toBe(1);
    expect(rows[0].overallAverage).toBe(100);
  });

  test('the subject profile still counts on its own', async () => {
    const service = build([{ student_id: STUDENT_ID, subject_id: SUBJECT_ID }]);

    const rows = await service.calculateClassTermResults(TERM_ID, CLASS_ID);

    expect(rows).toHaveLength(1);
    // Listed once, not twice: the two sources are unioned, not concatenated.
    expect(
      rows[0].subjects.filter((s: any) => s.subjectId === SUBJECT_ID),
    ).toHaveLength(1);
  });
});
