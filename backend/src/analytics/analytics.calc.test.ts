import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_RULES,
  atRiskReasons,
  classify,
  distribution,
  quantile,
  rateFromCounts,
  rollUp,
  submissionRates,
  toCsv,
  weekOf,
  weeklyTrend,
  type CellInput,
} from './analytics.calc';

const NOW = new Date('2026-11-10T12:00:00Z');
const cell = (over: Partial<CellInput> = {}): CellInput => ({
  kind: 'assignment',
  status: null,
  score: null,
  excused: false,
  submittedAt: null,
  lateSeconds: 0,
  dueAt: new Date('2026-11-05T12:00:00Z'),
  ...over,
});

describe('classify', () => {
  test('handed in on time, late, missing, pending and excused', () => {
    const at = new Date('2026-11-04T12:00:00Z');
    expect(classify(cell({ status: 'submitted', submittedAt: at }), NOW)).toBe('on_time');
    expect(classify(cell({ status: 'submitted', submittedAt: at, lateSeconds: 60 }), NOW)).toBe('late');
    expect(classify(cell(), NOW)).toBe('missing');
    expect(classify(cell({ dueAt: new Date('2026-11-20T00:00:00Z') }), NOW)).toBe('pending');
    expect(classify(cell({ dueAt: null }), NOW)).toBe('pending');
    // Excused wins, even over a hand-in.
    expect(classify(cell({ excused: true, status: 'submitted', submittedAt: at }), NOW)).toBe('excused');
  });

  test('a quiz in progress (draft) is not handed in; a mark counts as handed in', () => {
    expect(classify(cell({ kind: 'quiz', status: 'draft' }), NOW)).toBe('missing');
    expect(classify(cell({ status: 'graded', score: 7 }), NOW)).toBe('on_time');
    // Graded with no score (un-excused, never handed in) is not handed in.
    expect(classify(cell({ status: 'graded', score: null }), NOW)).toBe('missing');
  });

  test("an extension moves the student's own due date", () => {
    // The cell carries the extension date; still in the future, so not missing.
    expect(classify(cell({ dueAt: new Date('2026-11-12T00:00:00Z') }), NOW)).toBe('pending');
  });

  test('offline work is never missing; only a mark hands it in', () => {
    expect(classify(cell({ kind: 'offline' }), NOW)).toBe('pending');
    expect(classify(cell({ kind: 'offline', status: 'graded', score: 4 }), NOW)).toBe('on_time');
  });
});

describe('rates', () => {
  test('handed in over handed in + missing; excused and pending left out', () => {
    const r = submissionRates(['on_time', 'on_time', 'late', 'missing', 'excused', 'pending']);
    expect(r).toEqual({ onTime: 2, late: 1, missing: 1, excused: 1, pending: 1, handedIn: 3, rate: 75, onTimeRate: 50 });
  });

  test('nothing due yet is null, not 0 or 100', () => {
    expect(submissionRates(['pending', 'excused']).rate).toBeNull();
    expect(submissionRates([]).rate).toBeNull();
  });

  test('rounds to one decimal', () => {
    expect(rateFromCounts(1, 0, 2).rate).toBe(33.3);
    expect(rateFromCounts(2, 0, 1).rate).toBe(66.7);
  });
});

describe('distribution', () => {
  test('median and quartiles interpolate (R type 7)', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(quantile([5], 0.25)).toBe(5);
    expect(quantile([], 0.5)).toBeNull();
  });

  test('order does not matter; odd counts take the middle value', () => {
    const d = distribution([90, 50, 70, 60, 80]);
    expect(d).toMatchObject({ count: 5, min: 50, max: 90, mean: 70, median: 70, q1: 60, q3: 80 });
  });

  test('ten bins; 100 lands in the last, values outside 0..100 are clamped', () => {
    const d = distribution([0, 9.99, 10, 55, 99.9, 100, 104, -3]);
    expect(d.histogram.map((b) => b.count)).toEqual([3, 1, 0, 0, 0, 1, 0, 0, 0, 3]);
    expect(d.histogram[9]).toMatchObject({ from: 90, to: 100 });
  });

  test('empty: all nulls and zero bins', () => {
    const d = distribution([]);
    expect(d).toMatchObject({ count: 0, min: null, max: null, mean: null, median: null, q1: null, q3: null });
    expect(d.histogram.every((b) => b.count === 0)).toBe(true);
  });
});

describe('weekly trend', () => {
  test('local weeks start on Monday in the school time zone', () => {
    // Sunday 23:30 in New York is Monday 04:30 UTC, but belongs to the week before.
    expect(weekOf(new Date('2026-11-09T04:30:00Z'), 'America/New_York')).toBe('2026-11-02');
    expect(weekOf(new Date('2026-11-09T04:30:00Z'), 'UTC')).toBe('2026-11-09');
  });

  test('average per week, oldest first, only weeks with marks, capped', () => {
    const t = weeklyTrend(
      [
        { at: new Date('2026-11-10T10:00:00Z'), percent: 80 },
        { at: new Date('2026-11-11T10:00:00Z'), percent: 70 },
        { at: new Date('2026-10-20T10:00:00Z'), percent: 50 },
      ],
      'UTC',
    );
    expect(t).toEqual([
      { week: '2026-10-19', average: 50, count: 1 },
      { week: '2026-11-09', average: 75, count: 2 },
    ]);
    expect(weeklyTrend([{ at: new Date('2026-10-20T10:00:00Z'), percent: 50 }, { at: NOW, percent: 60 }], 'UTC', 1)).toEqual([
      { week: '2026-11-09', average: 60, count: 1 },
    ]);
  });
});

describe('at-risk rules', () => {
  const on = { attendance: true, mastery: true, levelLabel: (l: number) => ['Beginning', 'Developing'][l - 1] ?? null };
  const signals = { grade: 52.34, missingRecent: 3, attendanceRate: 80, masteryScore: 1.5 };

  test('every rule fires with its reason', () => {
    const r = atRiskReasons(signals, DEFAULT_RULES, on);
    expect(r.map((x) => x.rule)).toEqual(['grade', 'missing', 'attendance', 'mastery']);
    expect(r.map((x) => x.text)).toEqual([
      'Current grade 52.3% is below 60%',
      '3 pieces of work missing in the last 4 weeks',
      'Attendance 80% over the last 4 weeks is below 90%',
      'Average mastery 1.5 is below level 2 (Developing)',
    ]);
  });

  test('thresholds: at the line is not at risk; missing fires at the count', () => {
    const r = atRiskReasons({ grade: 60, missingRecent: 2, attendanceRate: 90, masteryScore: 2 }, DEFAULT_RULES, on);
    expect(r).toEqual([]);
    expect(atRiskReasons({ ...signals, missingRecent: 1 }, { ...DEFAULT_RULES, missingCount: 1 }, on)[1].text).toBe(
      '1 piece of work missing in the last 4 weeks',
    );
  });

  test('attendance and mastery rules do nothing while their features are off', () => {
    const r = atRiskReasons(signals, DEFAULT_RULES, { attendance: false, mastery: false });
    expect(r.map((x) => x.rule)).toEqual(['grade', 'missing']);
  });

  test('a rule switched off (null) or without data never fires', () => {
    const off = { minGrade: null, missingCount: null, windowWeeks: 2, minAttendance: null, masteryBelowLevel: null };
    expect(atRiskReasons(signals, off, on)).toEqual([]);
    expect(atRiskReasons({ grade: null, missingRecent: 0, attendanceRate: null, masteryScore: null }, DEFAULT_RULES, on)).toEqual([]);
  });
});

describe('roll-ups', () => {
  test('sums counts before dividing (never an average of averages)', () => {
    const r = rollUp([
      { students: 10, gradedStudents: 10, gradeSum: 900, onTime: 9, late: 0, missing: 1, excused: 0, attendanceCounted: 100, attendanceAttended: 90, atRisk: 1 },
      { students: 2, gradedStudents: 2, gradeSum: 100, onTime: 0, late: 1, missing: 1, excused: 3, attendanceCounted: 0, attendanceAttended: 0, atRisk: 2 },
    ]);
    expect(r).toEqual({
      courses: 2,
      enrolments: 12,
      averageGrade: 83.3,
      submissionRate: 83.3,
      onTime: 9,
      late: 1,
      missing: 2,
      attendanceRate: 90,
      atRisk: 3,
    });
  });

  test('empty roll-up has null rates', () => {
    expect(rollUp([])).toMatchObject({ courses: 0, averageGrade: null, submissionRate: null, attendanceRate: null });
  });
});

describe('CSV', () => {
  test('defuses formulas, quotes, keeps numbers and blanks', () => {
    const csv = toCsv([
      ['=HYPERLINK("x")', '+1', '-2', '@SUM(A1)', 'a,b', null, 42, -3.5],
    ]);
    expect(csv).toBe(`"'=HYPERLINK(""x"")",'+1,-2,'@SUM(A1),"a,b",,42,-3.5\r\n`);
  });
});
