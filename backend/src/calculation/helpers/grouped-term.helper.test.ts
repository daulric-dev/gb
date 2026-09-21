import { describe, expect, test } from 'bun:test';
import { computeGroupedTerm } from './grouped-term.helper';
import type {
  AssessmentRecord,
  GradeRecord,
  GradingGroup,
} from '../interfaces/grading-system.interface';

const ASSIGNMENTS: GradingGroup = {
  id: 'g-assign',
  name: 'Assignments',
  weight: 20,
  sortOrder: 0,
  isExam: false,
};
const QUIZZES: GradingGroup = {
  id: 'g-quiz',
  name: 'Quizzes',
  weight: 20,
  sortOrder: 1,
  isExam: false,
};
const EXAM: GradingGroup = {
  id: 'g-exam',
  name: 'Exam',
  weight: 60,
  sortOrder: 2,
  isExam: true,
};

function assessment(
  id: string,
  groupId: string | null,
  over: Partial<AssessmentRecord> = {},
): AssessmentRecord {
  return {
    id,
    title: id,
    assessment_type: 'coursework',
    grading_group_id: groupId,
    max_score: 100,
    weight: 1,
    is_excluded: false,
    sort_order: 0,
    subject_id: 'sub-1',
    term_id: 'term-1',
    ...over,
  };
}

function grades(pairs: [string, number | null][]): Map<string, GradeRecord> {
  return new Map(
    pairs.map(([assessmentId, score]) => [
      assessmentId,
      {
        id: `grade-${assessmentId}`,
        assessment_id: assessmentId,
        student_id: 'stu-1',
        score,
        is_excluded: false,
        exclusion_reason: null,
      },
    ]),
  );
}

describe('computeGroupedTerm', () => {
  test('weights groups against each other, not just assessments', () => {
    // 80 on assignments, 60 on quizzes, 50 on the exam
    // => 80*0.2 + 60*0.2 + 50*0.6 = 58
    const result = computeGroupedTerm(
      [ASSIGNMENTS, QUIZZES, EXAM],
      [
        assessment('a1', 'g-assign'),
        assessment('q1', 'g-quiz'),
        assessment('e1', 'g-exam', { assessment_type: 'exam' }),
      ],
      grades([
        ['a1', 80],
        ['q1', 60],
        ['e1', 50],
      ]),
    );

    expect(result.termComposite).toBe(58);
  });

  test('averages within a group before weighting it', () => {
    // assignments average (90 + 70) / 2 = 80, and that is the group's figure
    const result = computeGroupedTerm(
      [ASSIGNMENTS, QUIZZES, EXAM],
      [
        assessment('a1', 'g-assign'),
        assessment('a2', 'g-assign'),
        assessment('q1', 'g-quiz'),
        assessment('e1', 'g-exam'),
      ],
      grades([
        ['a1', 90],
        ['a2', 70],
        ['q1', 60],
        ['e1', 50],
      ]),
    );

    const assignments = result.groupAverages.find(
      (g) => g.groupId === 'g-assign',
    );
    expect(assignments?.average).toBe(80);
    expect(result.termComposite).toBe(58);
  });

  test('respects assessment weight inside a group', () => {
    // 100 at weight 3 and 60 at weight 1 => 90, not 80
    const result = computeGroupedTerm(
      [ASSIGNMENTS],
      [
        assessment('a1', 'g-assign', { weight: 3 }),
        assessment('a2', 'g-assign', { weight: 1 }),
      ],
      grades([
        ['a1', 100],
        ['a2', 60],
      ]),
    );

    expect(result.groupAverages[0].average).toBe(90);
  });

  test('renormalises over the groups that have marks', () => {
    // Only the two 20s are attempted, so the term is out of 40, not 100:
    // (80*20 + 60*20) / 40 = 70
    const result = computeGroupedTerm(
      [ASSIGNMENTS, QUIZZES, EXAM],
      [assessment('a1', 'g-assign'), assessment('q1', 'g-quiz')],
      grades([
        ['a1', 80],
        ['q1', 60],
      ]),
    );

    expect(result.termComposite).toBe(70);
    expect(result.examAverage).toBeNull();
  });

  test('splits into the continuous and exam blocks the year-end formulas use', () => {
    const result = computeGroupedTerm(
      [ASSIGNMENTS, QUIZZES, EXAM],
      [
        assessment('a1', 'g-assign'),
        assessment('q1', 'g-quiz'),
        assessment('e1', 'g-exam'),
      ],
      grades([
        ['a1', 80],
        ['q1', 60],
        ['e1', 50],
      ]),
    );

    // continuous block is the non-exam groups weighted among themselves
    expect(result.courseworkAverage).toBe(70);
    expect(result.examAverage).toBe(50);
  });

  test('an assessment with no group falls back to its old type', () => {
    const result = computeGroupedTerm(
      [ASSIGNMENTS, EXAM],
      [
        assessment('legacy-cw', null, { assessment_type: 'coursework' }),
        assessment('legacy-ex', null, { assessment_type: 'exam' }),
      ],
      grades([
        ['legacy-cw', 90],
        ['legacy-ex', 50],
      ]),
    );

    // 90*20 + 50*60 over 80 => 60
    expect(result.termComposite).toBe(60);
    expect(result.courseworkAverage).toBe(90);
    expect(result.examAverage).toBe(50);
  });

  test('excluded assessments and grades are left out', () => {
    const excluded = grades([
      ['a1', 80],
      ['a2', 20],
    ]);
    excluded.get('a2')!.is_excluded = true;

    const result = computeGroupedTerm(
      [ASSIGNMENTS],
      [assessment('a1', 'g-assign'), assessment('a2', 'g-assign')],
      excluded,
    );

    expect(result.groupAverages[0].average).toBe(80);
    expect(result.gradeCount).toBe(1);
  });

  test('a term with no marks at all has no composite', () => {
    const result = computeGroupedTerm(
      [ASSIGNMENTS, EXAM],
      [assessment('a1', 'g-assign')],
      grades([['a1', null]]),
    );

    expect(result.termComposite).toBeNull();
    expect(result.courseworkAverage).toBeNull();
    expect(result.gradeCount).toBe(0);
  });

  test('reproduces the old two-bucket maths for a 40/60 scheme', () => {
    // The seeded scheme: coursework 40, exam 60. 75 and 55 => 63.
    const coursework: GradingGroup = {
      id: 'g-cw',
      name: 'Coursework',
      weight: 40,
      sortOrder: 0,
      isExam: false,
    };
    const result = computeGroupedTerm(
      [coursework, EXAM],
      [
        assessment('c1', 'g-cw'),
        assessment('e1', 'g-exam', { assessment_type: 'exam' }),
      ],
      grades([
        ['c1', 75],
        ['e1', 55],
      ]),
    );

    expect(result.termComposite).toBe(63);
  });
});
