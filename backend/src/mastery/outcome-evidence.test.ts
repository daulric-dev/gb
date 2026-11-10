import { describe, expect, test } from 'bun:test';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { RubricService } from '@/grading/rubric.service';
import { SubmissionService } from '@/grading/submission.service';
import { GradebookImportService } from '@/grading/gradebook-import.service';
import { csvCell } from '@/grading/gradebook.service';
import {
  copyOutcomeAlignments,
  countsAsEvidence,
  markBeforePenalty,
  ratingRank,
  refreshOutcomeEvidence,
} from './outcome-evidence';
import { DEFAULT_SCALE, evidenceLevel } from './mastery.calc';

/**
 * Evidence: what a marked submission contributes to each aligned outcome,
 * and that it follows the mark when it changes. A small in-memory evidence
 * table sits on the Prisma mock so a re-mark can be seen to update, remove
 * and add rows.
 */

type Ev = {
  id: string;
  outcome_id: string;
  alignment_id: string;
  submission_id: string;
  student_id: string;
  course_id: string;
  activity_id: string;
  source: string;
  ratio: number;
  rating_rank: number | null;
  rating_count: number | null;
  assessed_at: Date;
};

function withEvidenceTable(prisma: MockPrisma) {
  const rows: Ev[] = [];
  let n = 0;
  prisma.outcome_evidence.findMany.mockImplementation(async ({ where }: any) =>
    rows.filter((r) => !where?.submission_id?.in || where.submission_id.in.includes(r.submission_id)),
  );
  prisma.outcome_evidence.createMany.mockImplementation(async ({ data }: any) => {
    for (const d of data) rows.push({ id: `ev-${++n}`, ...d });
    return { count: data.length };
  });
  prisma.outcome_evidence.update.mockImplementation(async ({ where, data }: any) => {
    const r = rows.find((x) => x.id === where.id)!;
    Object.assign(r, data);
    return r;
  });
  prisma.outcome_evidence.deleteMany.mockImplementation(async ({ where }: any) => {
    const before = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) if (where.id.in.includes(rows[i].id)) rows.splice(i, 1);
    return { count: before - rows.length };
  });
  return rows;
}

const GRADED_AT = new Date('2026-11-01T10:00:00Z');

function submission(over: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    student_id: 'stu-1',
    status: 'graded',
    excused: false,
    score: 6,
    raw_score: 8,
    graded_at: GRADED_AT,
    submitted_at: null,
    updated_at: GRADED_AT,
    ...over,
  };
}

function setup(opts: {
  kind?: string;
  points?: number;
  alignments?: any[];
  submissions?: any[];
} = {}) {
  const prisma = createMockPrisma();
  prisma.activity.findUnique.mockResolvedValue({
    id: 'act-1',
    course_id: 'course-1',
    kind: opts.kind ?? 'assignment',
    points: opts.points ?? 10,
  });
  prisma.outcome_alignment.findMany.mockResolvedValue(
    opts.alignments ?? [{ id: 'al-1', outcome_id: 'out-1', activity_id: 'act-1', criterion_id: null, question_id: null }],
  );
  let subs = opts.submissions ?? [submission()];
  prisma.submission.findMany.mockImplementation(async () => subs);
  const rows = withEvidenceTable(prisma);
  return { prisma, rows, setSubmissions: (s: any[]) => (subs = s) };
}

describe('evidence helpers', () => {
  test('only graded, not excused marks count', () => {
    expect(countsAsEvidence({ status: 'graded', excused: false })).toBe(true);
    expect(countsAsEvidence({ status: 'graded', excused: true })).toBe(false);
    expect(countsAsEvidence({ status: 'submitted', excused: false })).toBe(false);
  });

  test('the mark before the late penalty is used; an imported mark (no raw) is its score', () => {
    expect(markBeforePenalty({ score: 6, raw_score: 8 })).toBe(8);
    expect(markBeforePenalty({ score: 7, raw_score: null })).toBe(7);
    expect(markBeforePenalty({ score: null, raw_score: null })).toBeNull();
  });

  test('a rating rank counts from the lowest points, ties by position', () => {
    const ratings = [
      { id: 'top', points: 4, position: 0 },
      { id: 'low', points: 1, position: 3 },
      { id: 'mid-a', points: 2, position: 1 },
      { id: 'mid-b', points: 2, position: 2 },
    ];
    expect(ratingRank(ratings, 'low')).toEqual({ rank: 0, count: 4 });
    expect(ratingRank(ratings, 'mid-a')).toEqual({ rank: 1, count: 4 });
    expect(ratingRank(ratings, 'mid-b')).toEqual({ rank: 2, count: 4 });
    expect(ratingRank(ratings, 'top')).toEqual({ rank: 3, count: 4 });
    expect(ratingRank(ratings, 'gone')).toBeNull();
  });
});

describe('refreshOutcomeEvidence', () => {
  test('a whole-activity alignment records the raw mark over the points (no late penalty)', async () => {
    const { prisma, rows } = setup();
    await refreshOutcomeEvidence(prisma as any, 'act-1', ['stu-1']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome_id: 'out-1',
      alignment_id: 'al-1',
      submission_id: 'sub-1',
      student_id: 'stu-1',
      course_id: 'course-1',
      activity_id: 'act-1',
      source: 'activity',
      ratio: 0.8,
      assessed_at: GRADED_AT,
    });
    // Scoped to the activity's course and the student.
    expect(prisma.outcome_alignment.findMany.mock.calls[0][0].where.course_id).toBe('course-1');
    expect(prisma.submission.findMany.mock.calls[0][0].where).toEqual({
      activity_id: 'act-1',
      student_id: { in: ['stu-1'] },
    });
  });

  test('recomputes on re-mark: the same row is updated, not duplicated', async () => {
    const { prisma, rows, setSubmissions } = setup();
    await refreshOutcomeEvidence(prisma as any, 'act-1', ['stu-1']);
    const later = new Date('2026-11-05T10:00:00Z');
    setSubmissions([submission({ raw_score: 10, score: 10, graded_at: later })]);
    await refreshOutcomeEvidence(prisma as any, 'act-1', ['stu-1']);
    expect(rows).toHaveLength(1);
    expect(rows[0].ratio).toBe(1);
    expect(rows[0].assessed_at).toEqual(later);
    expect(evidenceLevel({ ratio: rows[0].ratio, ratingRank: null, ratingCount: null }, DEFAULT_SCALE)).toBe(4);
  });

  test('an unchanged mark writes nothing', async () => {
    const { prisma } = setup();
    await refreshOutcomeEvidence(prisma as any, 'act-1');
    await refreshOutcomeEvidence(prisma as any, 'act-1');
    expect(prisma.outcome_evidence.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.outcome_evidence.update).not.toHaveBeenCalled();
    expect(prisma.outcome_evidence.deleteMany).not.toHaveBeenCalled();
  });

  test('excusing (or un-marking) removes the evidence', async () => {
    const { prisma, rows, setSubmissions } = setup();
    await refreshOutcomeEvidence(prisma as any, 'act-1');
    expect(rows).toHaveLength(1);
    setSubmissions([submission({ excused: true })]);
    await refreshOutcomeEvidence(prisma as any, 'act-1');
    expect(rows).toHaveLength(0);
  });

  test('nothing aligned and no evidence: no further queries', async () => {
    const { prisma } = setup({ alignments: [] });
    await refreshOutcomeEvidence(prisma as any, 'act-1');
    expect(prisma.outcome_evidence.createMany).not.toHaveBeenCalled();
    expect(prisma.rubric_assessment.findMany).not.toHaveBeenCalled();
  });

  test('a rubric row alignment records the rating rank and points ratio', async () => {
    const { prisma, rows } = setup({
      alignments: [{ id: 'al-c', outcome_id: 'out-2', activity_id: null, criterion_id: 'c1', question_id: null }],
    });
    prisma.rubric_assessment.findMany.mockResolvedValue([
      { submission_id: 'sub-1', criterion_id: 'c1', rating_id: 'r-dev', points: 2 },
    ]);
    prisma.rubric_criterion.findMany.mockResolvedValue([
      {
        id: 'c1',
        points: 4,
        rubric_rating: [
          { id: 'r-ex', points: 4, position: 0 },
          { id: 'r-pro', points: 3, position: 1 },
          { id: 'r-dev', points: 2, position: 2 },
          { id: 'r-beg', points: 1, position: 3 },
        ],
      },
    ]);
    await refreshOutcomeEvidence(prisma as any, 'act-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'rubric', ratio: 0.5, rating_rank: 1, rating_count: 4 });
    // Four ratings on a four-level scale: one to one (Developing).
    expect(evidenceLevel({ ratio: 0.5, ratingRank: 1, ratingCount: 4 }, DEFAULT_SCALE)).toBe(2);
  });

  test('a quiz question alignment records the question credit, skipping unmarked essays', async () => {
    const { prisma, rows } = setup({
      kind: 'quiz',
      alignments: [
        { id: 'al-q1', outcome_id: 'out-3', activity_id: null, criterion_id: null, question_id: 'q1' },
        { id: 'al-q2', outcome_id: 'out-3', activity_id: null, criterion_id: null, question_id: 'q2' },
        { id: 'al-q3', outcome_id: 'out-4', activity_id: null, criterion_id: null, question_id: 'q3' },
      ],
    });
    prisma.quiz_question.findMany.mockResolvedValue([
      {
        id: 'q1',
        activity_id: 'act-1',
        kind: 'multiple_choice',
        points: 1,
        numeric_answer: null,
        numeric_tolerance: 0,
        partial_credit: false,
        quiz_option: [
          { id: 'o1', label: 'A', is_correct: true, match_label: null },
          { id: 'o2', label: 'B', is_correct: false, match_label: null },
        ],
      },
      {
        id: 'q2',
        activity_id: 'act-1',
        kind: 'essay',
        points: 4,
        numeric_answer: null,
        numeric_tolerance: 0,
        partial_credit: false,
        quiz_option: [],
      },
      {
        // A bank question this attempt was not given.
        id: 'q3',
        activity_id: null,
        kind: 'true_false',
        points: 1,
        numeric_answer: null,
        numeric_tolerance: 0,
        partial_credit: false,
        quiz_option: [],
      },
    ]);
    prisma.quiz_attempt_question.findMany.mockResolvedValue([
      { submission_id: 'sub-1', question_id: 'q1' },
      { submission_id: 'sub-1', question_id: 'q2' },
    ]);
    prisma.quiz_answer.findMany.mockResolvedValue([
      { submission_id: 'sub-1', question_id: 'q1', option_id: 'o1', option_ids: [], matches: null, text_answer: null, numeric_answer: null, file_id: null, manual_points: null },
      { submission_id: 'sub-1', question_id: 'q2', option_id: null, option_ids: [], matches: null, text_answer: 'An essay', numeric_answer: null, file_id: null, manual_points: null },
    ]);
    await refreshOutcomeEvidence(prisma as any, 'act-1');
    expect(rows.map((r) => [r.alignment_id, r.ratio])).toEqual([['al-q1', 1]]);
  });
});

describe('the mark-writing paths refresh evidence', () => {
  test('rubric marking refreshes after the criterion marks are written', async () => {
    const prisma = createMockPrisma();
    prisma.activity.findUnique.mockResolvedValue({
      id: 'act-1',
      course_id: 'course-1',
      kind: 'assignment',
      points: 10,
      status: 'published',
      rubric_id: 'rub-1',
    });
    const rubric = {
      id: 'rub-1',
      course_id: 'course-1',
      title: 'R',
      created_by: null,
      created_at: new Date(),
      updated_at: new Date(),
      rubric_criterion: [
        {
          id: 'c1',
          rubric_id: 'rub-1',
          title: 'Argument',
          description: null,
          points: 10,
          position: 0,
          rubric_rating: [{ id: 'r1', label: 'Strong', description: null, points: 10, position: 0 }],
        },
      ],
    };
    prisma.rubric.findUnique.mockResolvedValue(rubric);
    prisma.rubric.findFirst.mockResolvedValue(rubric);
    prisma.course_student.findFirst.mockResolvedValue({ student_id: 'stu-1' });
    prisma.submission.upsert.mockResolvedValue({ id: 'sub-1', student_id: 'stu-1', status: 'graded', score: 10 });
    const access = {
      require: async () => ({ course: { id: 'course-1', school_id: 'school-1' }, role: 'teacher' }),
    };
    const service = new RubricService(prisma as any, access as any, undefined as any);
    await service.assess('user-1', 'act-1', 'stu-1', { assessments: [{ criterionId: 'c1', ratingId: 'r1' }] });
    const written = prisma.rubric_assessment.createMany.mock.invocationCallOrder[0];
    const refreshed = prisma.outcome_alignment.findMany.mock.invocationCallOrder[0];
    expect(refreshed).toBeGreaterThan(written);
  });

  test('a teacher mark (and so LTI passback, which uses grade()) refreshes evidence', async () => {
    const prisma = createMockPrisma();
    prisma.activity.findUnique.mockResolvedValue({
      id: 'act-1',
      course_id: 'course-1',
      kind: 'offline',
      points: 20,
      status: 'published',
    });
    prisma.course_student.findFirst.mockResolvedValue({ student_id: 'stu-1' });
    prisma.submission.upsert.mockImplementation(async ({ create }: any) => ({ id: 'sub-1', excused: false, ...create }));
    const access = {
      require: async () => ({ course: { id: 'course-1' }, role: 'teacher' }),
      courseIdOfActivity: async () => 'course-1',
    };
    const service = new SubmissionService(prisma as any, {} as any, access as any, undefined, undefined, undefined);
    await service.grade('user-1', 'act-1', 'stu-1', { score: 15 });
    expect(prisma.outcome_alignment.findMany).toHaveBeenCalled();
    expect(prisma.outcome_alignment.findMany.mock.calls[0][0].where.course_id).toBe('course-1');
  });

  test('the gradebook import refreshes evidence for every imported mark', async () => {
    const prisma = createMockPrisma();
    prisma.activity.findMany.mockResolvedValue([{ id: 'a1', title: 'Essay', points: 10, kind: 'assignment' }]);
    prisma.course_student.findMany.mockResolvedValue([{ student_id: 'stu-1' }]);
    prisma.student.findMany.mockResolvedValue([{ id: 'stu-1', first_name: 'A', last_name: 'B', user_profile: null }]);
    prisma.submission.findMany.mockResolvedValue([]);
    prisma.submission.upsert.mockResolvedValue({ id: 'sub-1' });
    prisma.activity.findUnique.mockResolvedValue({ id: 'a1', course_id: 'course-1', kind: 'assignment', points: 10 });
    const csv = [
      ['Last name', 'First name', 'Student ID', 'Essay (10)'].map(csvCell).join(','),
      ['B', 'A', 'stu-1', '7'].map(csvCell).join(','),
    ].join('\n');
    const service = new GradebookImportService(prisma as any, { require: async () => ({}) } as any, undefined as any);
    await service.apply('user-1', 'course-1', csv);
    expect(prisma.activity.findUnique.mock.calls.some((c: any) => c[0].where.id === 'a1')).toBe(true);
    expect(prisma.outcome_alignment.findMany).toHaveBeenCalled();
  });
});

describe('copyOutcomeAlignments (for course copy and template import)', () => {
  test('copies course outcomes and remaps alignments; school outcomes only within the school', async () => {
    const prisma = createMockPrisma();
    prisma.course.findUnique.mockImplementation(async ({ where }: any) => ({
      school_id: where.id === 'src' ? 'school-1' : 'school-1',
    }));
    prisma.outcome.findMany.mockResolvedValue([
      { id: 'own-parent', parent_id: null, code: 'C1', title: 'Parent', description: null, subject: null, grade_level: null, position: 0, archived_at: null },
      { id: 'own-child', parent_id: 'own-parent', code: 'C1.a', title: 'Child', description: null, subject: null, grade_level: null, position: 1, archived_at: null },
    ]);
    prisma.outcome_alignment.findMany.mockResolvedValue([
      { outcome_id: 'own-child', activity_id: 'act-src', criterion_id: null, question_id: null, outcome: { course_id: 'src', school_id: 'school-1' } },
      { outcome_id: 'school-o', activity_id: null, criterion_id: 'crit-src', question_id: null, outcome: { course_id: null, school_id: 'school-1' } },
      { outcome_id: 'school-o', activity_id: 'not-copied', criterion_id: null, question_id: null, outcome: { course_id: null, school_id: 'school-1' } },
    ]);
    let n = 0;
    prisma.outcome.create.mockImplementation(async () => ({ id: `new-${++n}` }));
    const result = await copyOutcomeAlignments(prisma as any, {
      sourceCourseId: 'src',
      targetCourseId: 'dst',
      activityIds: new Map([['act-src', 'act-dst']]),
      criterionIds: new Map([['crit-src', 'crit-dst']]),
    });
    expect(result).toEqual({ outcomes: 2, alignments: 2 });
    const creates = prisma.outcome.create.mock.calls.map((c: any) => c[0].data);
    expect(creates[0]).toMatchObject({ code: 'C1', course_id: 'dst', parent_id: null });
    expect(creates[1]).toMatchObject({ code: 'C1.a', parent_id: 'new-1' });
    const aligned = prisma.outcome_alignment.createMany.mock.calls.map((c: any) => c[0].data[0]);
    expect(aligned).toEqual([
      { outcome_id: 'new-2', course_id: 'dst', created_by: null, activity_id: 'act-dst' },
      { outcome_id: 'school-o', course_id: 'dst', created_by: null, criterion_id: 'crit-dst' },
    ]);
    // Evidence is never copied.
    expect(prisma.outcome_evidence.createMany).not.toHaveBeenCalled();
  });

  test('another school: school outcomes are left out', async () => {
    const prisma = createMockPrisma();
    prisma.course.findUnique.mockImplementation(async ({ where }: any) => ({
      school_id: where.id === 'src' ? 'school-1' : 'school-2',
    }));
    prisma.outcome.findMany.mockResolvedValue([]);
    prisma.outcome_alignment.findMany.mockResolvedValue([
      { outcome_id: 'school-o', activity_id: 'act-src', criterion_id: null, question_id: null, outcome: { course_id: null, school_id: 'school-1' } },
    ]);
    const result = await copyOutcomeAlignments(prisma as any, {
      sourceCourseId: 'src',
      targetCourseId: 'dst',
      activityIds: new Map([['act-src', 'act-dst']]),
    });
    expect(result).toEqual({ outcomes: 0, alignments: 0 });
    expect(prisma.outcome_alignment.createMany).not.toHaveBeenCalled();
  });
});
