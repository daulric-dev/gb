import { describe, expect, test } from 'bun:test';
import type { CalcBand, CalcGroup, CalcSubmission } from '@/grading/gradebook.calc';
import {
  activityInTerm,
  commentCompletion,
  courseTermMode,
  finalCourseGrade,
  reportFileName,
  studentDisplayName,
  summariseAttendance,
  termCutoff,
  termStart,
  type TermGradeActivity,
} from './report-card.calc';

const BANDS: CalcBand[] = [
  { label: 'A', minPercentage: 90, maxPercentage: 100 },
  { label: 'B', minPercentage: 80, maxPercentage: 89 },
  { label: 'C', minPercentage: 70, maxPercentage: 79 },
  { label: 'F', minPercentage: 0, maxPercentage: 69 },
];

function act(id: string, over: Partial<TermGradeActivity> = {}): TermGradeActivity {
  return {
    id,
    assignmentGroupId: null,
    points: 10,
    status: 'published',
    omitFromFinalGrade: false,
    due_at: '2026-10-01T00:00:00Z',
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

const graded = (score: number, over: Partial<CalcSubmission> = {}): CalcSubmission => ({
  status: 'graded',
  score,
  excused: false,
  ...over,
});

describe('courseTermMode', () => {
  const term = { id: 't1', academic_year_id: 'y1' };

  test('a course set to the term is graded on its whole gradebook', () => {
    expect(courseTermMode({ term_id: 't1', academic_year_id: 'y1' }, term)).toBe('term');
  });

  test('a course set to another term is not on the report', () => {
    expect(courseTermMode({ term_id: 't2', academic_year_id: 'y1' }, term)).toBeNull();
  });

  test('a year course with no term is on every term of its year', () => {
    expect(courseTermMode({ term_id: null, academic_year_id: 'y1' }, term)).toBe('year');
    expect(courseTermMode({ term_id: null, academic_year_id: 'y2' }, term)).toBeNull();
    expect(courseTermMode({ term_id: null, academic_year_id: null }, term)).toBeNull();
  });
});

describe('term window', () => {
  test('the cutoff is the end of the last day, UTC', () => {
    expect(termCutoff(new Date('2026-12-15'))!.toISOString()).toBe('2026-12-15T23:59:59.999Z');
    expect(termCutoff(null)).toBeNull();
    expect(termStart(new Date('2026-09-01'))!.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  test('year courses count work due by the cutoff (undated work by creation)', () => {
    const cutoff = termCutoff(new Date('2026-12-15'));
    expect(activityInTerm({ due_at: '2026-12-15T22:00:00Z', created_at: null }, 'year', cutoff)).toBe(true);
    expect(activityInTerm({ due_at: '2026-12-16T00:00:00Z', created_at: null }, 'year', cutoff)).toBe(false);
    expect(activityInTerm({ due_at: null, created_at: '2027-01-05T00:00:00Z' }, 'year', cutoff)).toBe(false);
    expect(activityInTerm({ due_at: null, created_at: '2026-11-05T00:00:00Z' }, 'year', cutoff)).toBe(true);
    // A term course counts everything; no cutoff counts everything.
    expect(activityInTerm({ due_at: '2027-06-01T00:00:00Z', created_at: null }, 'term', cutoff)).toBe(true);
    expect(activityInTerm({ due_at: '2027-06-01T00:00:00Z', created_at: null }, 'year', null)).toBe(true);
  });
});

describe('finalCourseGrade', () => {
  test('unweighted: earned over possible, with the letter from the scale', () => {
    const subs = new Map([
      ['a1', graded(9)],
      ['a2', graded(8)],
    ]);
    expect(finalCourseGrade([], [act('a1'), act('a2')], subs, BANDS, 'term', null)).toEqual({
      percent: 85,
      letter: 'B',
    });
  });

  test('excused work and work omitted from the final grade are left out', () => {
    const subs = new Map([
      ['a1', graded(10)],
      ['a2', graded(0, { excused: true })],
      ['a3', graded(0)],
    ]);
    const grade = finalCourseGrade(
      [],
      [act('a1'), act('a2'), act('a3', { omitFromFinalGrade: true })],
      subs,
      BANDS,
      'term',
      null,
    );
    expect(grade).toEqual({ percent: 100, letter: 'A' });
  });

  test('weighted groups are renormalised over groups with marks', () => {
    const groups: CalcGroup[] = [
      { id: 'hw', name: 'Homework', weight: 40, position: 0 },
      { id: 'ex', name: 'Exams', weight: 60, position: 1 },
      { id: 'pr', name: 'Project', weight: 20, position: 2 },
    ];
    const subs = new Map([
      ['h1', graded(10)],
      ['e1', graded(50, {})],
    ]);
    const grade = finalCourseGrade(
      groups,
      [act('h1', { assignmentGroupId: 'hw' }), act('e1', { assignmentGroupId: 'ex', points: 100 }), act('p1', { assignmentGroupId: 'pr' })],
      subs,
      BANDS,
      'term',
      null,
    );
    // (40 x 100 + 60 x 50) / 100 = 70; the empty project group does not count.
    expect(grade).toEqual({ percent: 70, letter: 'C' });
  });

  test('a year course only counts work due by the end of the term', () => {
    const subs = new Map([
      ['early', graded(10)],
      ['late', graded(0)],
    ]);
    const acts = [act('early', { due_at: '2026-11-01T00:00:00Z' }), act('late', { due_at: '2027-03-01T00:00:00Z' })];
    const cutoff = termCutoff(new Date('2026-12-15'));
    expect(finalCourseGrade([], acts, subs, BANDS, 'year', cutoff)).toEqual({ percent: 100, letter: 'A' });
    expect(finalCourseGrade([], acts, subs, BANDS, 'term', cutoff)).toEqual({ percent: 50, letter: 'F' });
  });

  test('nothing marked: no grade and no letter; no scale: no letter', () => {
    expect(finalCourseGrade([], [act('a1')], new Map(), BANDS, 'term', null)).toEqual({ percent: null, letter: null });
    expect(finalCourseGrade([], [act('a1')], new Map([['a1', graded(7)]]), [], 'term', null)).toEqual({
      percent: 70,
      letter: null,
    });
  });

  test('drafts never count', () => {
    const subs = new Map([['d1', graded(0)], ['a1', graded(9)]]);
    expect(finalCourseGrade([], [act('d1', { status: 'draft' }), act('a1')], subs, BANDS, 'term', null).percent).toBe(90);
  });
});

describe('summariseAttendance', () => {
  test('counts each status and ignores anything else', () => {
    expect(
      summariseAttendance([
        { status: 'present' },
        { status: 'present' },
        { status: 'late' },
        { status: 'absent' },
        { status: 'excused' },
        { status: 'unknown' },
      ]),
    ).toEqual({ present: 2, late: 1, absent: 1, excused: 1, total: 5 });
  });
});

describe('commentCompletion', () => {
  test('ready, draft and missing per enrolled student', () => {
    expect(
      commentCompletion(
        ['s1', 's2', 's3', 's4'],
        [
          { student_id: 's1', status: 'ready', body: 'Good' },
          { student_id: 's2', status: 'draft', body: 'Half done' },
          { student_id: 's3', status: 'draft', body: '  ' },
          { student_id: 'gone', status: 'ready', body: 'Dropped student' },
        ],
      ),
    ).toEqual({ students: 4, ready: 1, draft: 1, missing: 2 });
  });
});

describe('names', () => {
  test('display names and file names', () => {
    expect(studentDisplayName({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace');
    expect(studentDisplayName({ first_name: null, last_name: null })).toBe('Student');
    expect(reportFileName({ first_name: 'Zoë', last_name: "O'Brien/../x" }, 'Term 1')).toBe('OBrien..x-Zoe-Term-1-report.pdf');
  });
});
