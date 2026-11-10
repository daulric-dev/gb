import { describe, expect, test } from 'bun:test';
import { describeAlert, evaluate, tally, trailingAbsences, type DatedRecord } from './rates';

const day = (n: number) => new Date(Date.UTC(2026, 10, n, 9));
const recs = (...statuses: DatedRecord['status'][]): DatedRecord[] =>
  statuses.map((status, i) => ({ status, at: day(i + 1) }));

describe('attendance percentage', () => {
  test('present and late count as attended; excused does not count', () => {
    expect(tally(recs('present', 'late', 'absent', 'excused'))).toEqual({
      present: 1, late: 1, absent: 1, excused: 1, rate: 66.7,
    });
  });
  test('nothing counted is null, not 0 or 100', () => {
    expect(tally([]).rate).toBeNull();
    expect(tally(recs('excused', 'excused')).rate).toBeNull();
  });
  test('all absent is 0, all present 100, rounding to one decimal', () => {
    expect(tally(recs('absent', 'absent')).rate).toBe(0);
    expect(tally(recs('present')).rate).toBe(100);
    expect(tally(recs('present', 'present', 'absent')).rate).toBe(66.7);
  });
});

describe('absences in a row', () => {
  test('counts from the newest, skipping excused, stopping at present or late', () => {
    expect(trailingAbsences(recs('present', 'absent', 'excused', 'absent'))).toBe(2);
    expect(trailingAbsences(recs('absent', 'absent', 'late'))).toBe(0);
    expect(trailingAbsences([])).toBe(0);
    // Order of input does not matter.
    expect(trailingAbsences(recs('present', 'absent', 'absent').reverse())).toBe(2);
  });
});

describe('thresholds', () => {
  const t = { minRate: 90, windowDays: 28, minSessions: 5, consecutiveAbsences: 3 };

  test('low rate needs enough sessions before it alerts', () => {
    const [few] = evaluate(t, recs('absent', 'absent'), []);
    expect(few).toMatchObject({ kind: 'low_rate', active: false, recovered: false });
    const window = recs('present', 'present', 'present', 'present', 'absent');
    const [low] = evaluate(t, window, window);
    expect(low).toMatchObject({ kind: 'low_rate', active: true, value: 80, threshold: 90 });
  });

  test('exactly at the threshold is not below it, and counts as recovered', () => {
    const window = recs(...Array(9).fill('present'), 'absent');
    const [c] = evaluate(t, window, window);
    expect(c).toMatchObject({ active: false, recovered: true, value: 90 });
  });

  test('an empty window recovers; consecutive absences alert at N', () => {
    const [rate, run] = evaluate(t, [], recs('present', 'absent', 'absent', 'absent'));
    expect(rate.recovered).toBe(true);
    expect(run).toMatchObject({ kind: 'consecutive_absences', active: true, value: 3 });
    const [, back] = evaluate(t, [], recs('absent', 'absent', 'absent', 'present'));
    expect(back).toMatchObject({ active: false, recovered: true });
  });

  test('a switched-off check is not evaluated', () => {
    expect(evaluate({ ...t, minRate: null, consecutiveAbsences: null }, recs('absent'), [])).toEqual([]);
  });

  test('wording', () => {
    expect(describeAlert({ kind: 'low_rate', value: 82.5, threshold: 90, windowDays: 28 })).toBe(
      'Attendance 82.5% over the last 4 weeks, below 90%.',
    );
    expect(describeAlert({ kind: 'consecutive_absences', value: 3, threshold: 3, windowDays: null })).toBe(
      '3 absences in a row (alert at 3).',
    );
  });
});
