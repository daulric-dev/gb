import { describe, expect, test } from 'bun:test';
import { parseCsv } from '@/grading/gradebook-import';
import {
  DEFAULT_SCALE,
  type MasteryScale,
  calculateMastery,
  decayingAverage,
  defaultBands,
  evidenceLevel,
  levelForPercent,
  levelForRank,
  levelForScore,
  masteryScore,
  parentsFirst,
  parseOutcomeCsv,
  scaleFromRow,
  validateScale,
} from './mastery.calc';

const day = (d: number) => new Date(Date.UTC(2026, 9, d));
const items = (...levels: number[]) => levels.map((level, i) => ({ level, at: day(i + 1) }));
const scale = (over: Partial<MasteryScale> = {}): MasteryScale => ({ ...DEFAULT_SCALE, ...over });

describe('evidence → level', () => {
  test('score bands: the band with the highest start at or below the percent', () => {
    const bands = DEFAULT_SCALE.scoreBands; // 0→1, 50→2, 70→3, 90→4
    expect(levelForPercent(bands, 0)).toBe(1);
    expect(levelForPercent(bands, 49.99)).toBe(1);
    expect(levelForPercent(bands, 50)).toBe(2);
    expect(levelForPercent(bands, 69.9)).toBe(2);
    expect(levelForPercent(bands, 70)).toBe(3);
    expect(levelForPercent(bands, 89)).toBe(3);
    expect(levelForPercent(bands, 90)).toBe(4);
    expect(levelForPercent(bands, 100)).toBe(4);
  });

  test('configurable bands', () => {
    const bands = [
      { minPercent: 0, level: 1 },
      { minPercent: 60, level: 3 },
    ];
    expect(levelForPercent(bands, 59)).toBe(1);
    expect(levelForPercent(bands, 60)).toBe(3);
  });

  test('rubric rank maps proportionally onto the scale', () => {
    // As many ratings as levels: one to one.
    expect([0, 1, 2, 3].map((r) => levelForRank(r, 4, 4))).toEqual([1, 2, 3, 4]);
    // Three ratings on four levels: lowest 1, middle rounds to 3, top 4.
    expect([0, 1, 2].map((r) => levelForRank(r, 3, 4))).toEqual([1, 3, 4]);
    // Five ratings on four levels.
    expect([0, 1, 2, 3, 4].map((r) => levelForRank(r, 5, 4))).toEqual([1, 2, 3, 3, 4]);
    // Two ratings on a three-level scale.
    expect([0, 1].map((r) => levelForRank(r, 2, 3))).toEqual([1, 3]);
  });

  test('a rubric rating uses its rank; bare rubric points and scores use the bands', () => {
    expect(evidenceLevel({ ratio: 0.1, ratingRank: 3, ratingCount: 4 }, DEFAULT_SCALE)).toBe(4);
    expect(evidenceLevel({ ratio: 0.75, ratingRank: null, ratingCount: null }, DEFAULT_SCALE)).toBe(3);
    // A one-rating criterion has no rank to speak of: bands.
    expect(evidenceLevel({ ratio: 0.55, ratingRank: 0, ratingCount: 1 }, DEFAULT_SCALE)).toBe(2);
    expect(evidenceLevel({ ratio: 1.2, ratingRank: null, ratingCount: null }, DEFAULT_SCALE)).toBe(4);
  });
});

describe('calculation methods', () => {
  test('most recent, highest and mean', () => {
    const xs = items(4, 2, 3);
    expect(masteryScore(xs, 'most_recent', 0.65)).toBe(3);
    expect(masteryScore(xs, 'highest', 0.65)).toBe(4);
    expect(masteryScore(xs, 'mean', 0.65)).toBe(3);
  });

  test('order is by assessment time, not input order', () => {
    const xs = [
      { level: 1, at: day(9) },
      { level: 4, at: day(1) },
    ];
    expect(masteryScore(xs, 'most_recent', 0.65)).toBe(1);
  });

  test('decaying average: newest counts 65%, everything before 35%', () => {
    expect(decayingAverage([3], 0.65)).toBe(3);
    // 2 → 0.35×2 + 0.65×3 = 2.65
    expect(decayingAverage([2, 3], 0.65)).toBeCloseTo(2.65, 10);
    // 2.65 → 0.35×2.65 + 0.65×4 = 3.5275
    expect(decayingAverage([2, 3, 4], 0.65)).toBeCloseTo(3.5275, 10);
    // A different weight.
    expect(decayingAverage([1, 4], 0.5)).toBeCloseTo(2.5, 10);
    expect(masteryScore(items(2, 3, 4), 'decaying_average', 0.65)).toBeCloseTo(3.5275, 10);
  });

  test('no evidence', () => {
    expect(masteryScore([], 'mean', 0.65)).toBeNull();
    expect(calculateMastery([], DEFAULT_SCALE)).toEqual({
      score: null,
      level: null,
      label: null,
      status: 'no_evidence',
      mastered: false,
      evidenceCount: 0,
    });
  });

  test('a score falls in the level at or below it', () => {
    expect(levelForScore(3.5275, 4)).toBe(3);
    expect(levelForScore(2.9999999999, 4)).toBe(3);
    expect(levelForScore(0.5, 4)).toBe(1);
    expect(levelForScore(4, 4)).toBe(4);
  });

  test('mastered at the threshold with enough evidence', () => {
    const r = calculateMastery(items(2, 3, 4), DEFAULT_SCALE);
    expect(r).toEqual({
      score: 3.53,
      level: 3,
      label: 'Proficient',
      status: 'mastered',
      mastered: true,
      evidenceCount: 3,
    });
    expect(calculateMastery(items(4, 1), DEFAULT_SCALE)).toMatchObject({ status: 'not_yet', mastered: false });
  });

  test('minimum evidence: at the threshold but too few items is not yet mastered', () => {
    const s = scale({ minEvidence: 3 });
    expect(calculateMastery(items(4, 4), s)).toMatchObject({
      status: 'needs_more_evidence',
      mastered: false,
      label: 'Exceeding',
    });
    expect(calculateMastery(items(4, 4, 4), s)).toMatchObject({ status: 'mastered', mastered: true });
  });

  test('each method decides mastery from the same evidence', () => {
    const xs = items(4, 1, 2); // newest is 2
    expect(calculateMastery(xs, scale({ calculation: 'highest' })).mastered).toBe(true);
    expect(calculateMastery(xs, scale({ calculation: 'most_recent' })).mastered).toBe(false);
    expect(calculateMastery(xs, scale({ calculation: 'mean' })).score).toBe(2.33);
  });
});

describe('scale', () => {
  test('defaults: four levels, Proficient to master, decaying average 0.65, one item', () => {
    const s = scaleFromRow(null);
    expect(s.levels).toEqual(['Beginning', 'Developing', 'Proficient', 'Exceeding']);
    expect(s.masteryThreshold).toBe(3);
    expect(s.calculation).toBe('decaying_average');
    expect(s.decayWeight).toBe(0.65);
    expect(s.minEvidence).toBe(1);
    expect(validateScale(s)).toBeNull();
  });

  test('validation', () => {
    expect(validateScale(scale({ levels: ['Only'] }))).toMatch(/2 to 10/);
    expect(validateScale(scale({ levels: ['A', 'a', 'B', 'C'] }))).toMatch(/different/);
    expect(validateScale(scale({ masteryThreshold: 5 }))).toMatch(/between 1 and 4/);
    expect(validateScale(scale({ decayWeight: 1 }))).toMatch(/weight/);
    expect(validateScale(scale({ minEvidence: 0 }))).toMatch(/Minimum/);
    expect(validateScale(scale({ scoreBands: [{ minPercent: 10, level: 1 }] }))).toMatch(/start at 0/);
    expect(
      validateScale(scale({ scoreBands: [{ minPercent: 0, level: 1 }, { minPercent: 50, level: 5 }] })),
    ).toMatch(/between 1 and 4/);
    expect(
      validateScale(scale({ scoreBands: [{ minPercent: 0, level: 2 }, { minPercent: 50, level: 1 }] })),
    ).toMatch(/go up/);
  });

  test('stored rows: editable labels and count; broken bands fall back for the stored levels', () => {
    const row = {
      levels: ['Not yet', 'Approaching', 'Meeting'],
      mastery_threshold: 3,
      calculation: 'mean',
      decay_weight: '0.50',
      min_evidence: 2,
      score_bands: [{ minPercent: 0, level: 1 }, { minPercent: 60, level: 2 }, { minPercent: 80, level: 3 }],
      report_card_section: true,
    };
    expect(scaleFromRow(row)).toMatchObject({ levels: row.levels, calculation: 'mean', decayWeight: 0.5, minEvidence: 2 });
    const broken = scaleFromRow({ ...row, score_bands: 'nope' });
    expect(broken.scoreBands).toEqual(defaultBands(3));
  });
});

describe('outcome CSV', () => {
  const csv = (text: string) => parseOutcomeCsv(parseCsv(text));

  test('reads rows with optional columns and header aliases', () => {
    const out = csv('Code,Title,Description,Subject,Grade level,Parent\nM.1,Number,,Maths,4,\nM.1.a,Count to 100,Counting,Maths,4,M.1\n');
    expect(out.errors).toEqual([]);
    expect(out.rows).toEqual([
      { line: 2, code: 'M.1', title: 'Number', description: null, subject: 'Maths', gradeLevel: '4', parentCode: null },
      { line: 3, code: 'M.1.a', title: 'Count to 100', description: 'Counting', subject: 'Maths', gradeLevel: '4', parentCode: 'M.1' },
    ]);
  });

  test('errors: missing columns, duplicates, unknown parents and loops', () => {
    expect(csv('name\nx').errors[0].message).toMatch(/code and title/);
    const out = csv('code,title,parent_code\nA,One,\nA,Again,\nB,Two,Z\nC,Three,D\nD,Four,C\n,No code,\n');
    const messages = out.errors.map((e) => `${e.line}: ${e.message}`);
    expect(messages).toContain('3: Code A appears twice');
    expect(messages).toContain('4: Parent Z is not in the file');
    expect(messages.some((m) => m.startsWith('5:') && m.includes('loop'))).toBe(true);
    expect(messages).toContain('7: Each row needs a code and a title');
  });

  test('parents are placed before their children', () => {
    const { rows } = csv('code,title,parent_code\nC,Grandchild,B\nB,Child,A\nA,Root,\n');
    expect(parentsFirst(rows).map((r) => r.code)).toEqual(['A', 'B', 'C']);
  });
});
