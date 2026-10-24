import { describe, test, expect } from 'bun:test';
import {
  CalcActivity,
  CalcGroup,
  CalcSubmission,
  DropItem,
  applyDrops,
  bestSubset,
  calculateCourseGrade,
  ratioSearchSubset,
  counts,
  isWeighted,
  letterFor,
} from './gradebook.calc';

/**
 * The course total, pinned rule by rule against LMS_REVAMP_PLAN.md
 * ("Grade calculation"). Every portal card, grades page and gradebook cell
 * comes from this one function, so a regression here is a wrong grade
 * everywhere at once.
 */

function act(
  id: string,
  groupId: string | null,
  points: number,
  over: Partial<CalcActivity> = {},
): CalcActivity {
  return {
    id,
    assignmentGroupId: groupId,
    points,
    status: 'published',
    omitFromFinalGrade: false,
    ...over,
  };
}

function graded(score: number, over: Partial<CalcSubmission> = {}) {
  return { status: 'graded', score, excused: false, ...over } as CalcSubmission;
}

const HW: CalcGroup = { id: 'hw', name: 'Homework', weight: 40, position: 0 };
const EX: CalcGroup = { id: 'ex', name: 'Exams', weight: 60, position: 1 };

describe('counts', () => {
  test('a graded, published, not excused mark counts', () => {
    expect(counts(act('a', null, 10), graded(5))).toBe(true);
  });

  test('closed work still counts', () => {
    expect(counts(act('a', null, 10, { status: 'closed' }), graded(5))).toBe(
      true,
    );
  });

  test('drafts never count', () => {
    expect(counts(act('a', null, 10, { status: 'draft' }), graded(5))).toBe(
      false,
    );
  });

  test('omitted activities never count', () => {
    expect(
      counts(act('a', null, 10, { omitFromFinalGrade: true }), graded(5)),
    ).toBe(false);
  });

  test('submitted but unmarked work is ignored', () => {
    expect(
      counts(act('a', null, 10), {
        status: 'submitted',
        score: null,
        excused: false,
      }),
    ).toBe(false);
  });

  test('excused marks do not count', () => {
    expect(counts(act('a', null, 10), graded(5, { excused: true }))).toBe(
      false,
    );
  });

  test('a graded row with no score does not count', () => {
    expect(
      counts(act('a', null, 10), {
        status: 'graded',
        score: null,
        excused: false,
      }),
    ).toBe(false);
  });

  test('no submission does not count', () => {
    expect(counts(act('a', null, 10), undefined)).toBe(false);
  });
});

describe('isWeighted', () => {
  test('any positive weight makes the course weighted', () => {
    expect(isWeighted([HW, { ...EX, weight: null }])).toBe(true);
  });

  test('all null or zero weights are unweighted', () => {
    expect(
      isWeighted([
        { ...HW, weight: null },
        { ...EX, weight: 0 },
      ]),
    ).toBe(false);
    expect(isWeighted([])).toBe(false);
  });
});

describe('calculateCourseGrade - weighted', () => {
  test('weights each group by its percentage', () => {
    // Homework 8/10 = 80%, Exams 45/50 = 90% -> 0.4*80 + 0.6*90 = 86
    const result = calculateCourseGrade(
      [HW, EX],
      [act('h1', 'hw', 10), act('e1', 'ex', 50)],
      { h1: graded(8), e1: graded(45) },
    );

    expect(result.percent).toBe(86);
    expect(result.groups).toEqual([
      {
        groupId: 'hw',
        name: 'Homework',
        weight: 40,
        earned: 8,
        possible: 10,
        percent: 80,
        dropped: [],
      },
      {
        groupId: 'ex',
        name: 'Exams',
        weight: 60,
        earned: 45,
        possible: 50,
        percent: 90,
        dropped: [],
      },
    ]);
  });

  test('renormalises over groups with marked work', () => {
    // No exam yet: Homework alone is the whole grade.
    const result = calculateCourseGrade(
      [HW, EX],
      [act('h1', 'hw', 10), act('e1', 'ex', 50)],
      { h1: graded(7) },
    );

    expect(result.percent).toBe(70);
    expect(result.groups[1].percent).toBeNull();
    expect(result.groups[1].possible).toBe(0);
  });

  test('weights need not total 100', () => {
    // 10 and 30: Homework 50%, Exams 100% -> (10*50 + 30*100) / 40 = 87.5
    const result = calculateCourseGrade(
      [
        { ...HW, weight: 10 },
        { ...EX, weight: 30 },
      ],
      [act('h1', 'hw', 10), act('e1', 'ex', 10)],
      { h1: graded(5), e1: graded(10) },
    );
    expect(result.percent).toBe(87.5);
  });

  test('a group percentage is points-based within the group', () => {
    // 1/1 and 10/100 -> 11/101, not the mean of 100% and 10%.
    const result = calculateCourseGrade(
      [HW],
      [act('h1', 'hw', 1), act('h2', 'hw', 100)],
      { h1: graded(1), h2: graded(10) },
    );
    expect(result.groups[0].percent).toBe(10.89);
    expect(result.percent).toBe(10.89);
  });

  test('ungrouped work counts for nothing in a weighted course', () => {
    const result = calculateCourseGrade(
      [HW, EX],
      [act('h1', 'hw', 10), act('u1', null, 10)],
      { h1: graded(9), u1: graded(0) },
    );

    expect(result.percent).toBe(90);
    const ungrouped = result.groups.find((g) => g.groupId === null)!;
    expect(ungrouped.name).toBe('Ungrouped');
    expect(ungrouped.weight).toBe(0);
    expect(ungrouped.percent).toBe(0);
  });

  test('a group with no weight counts for nothing when others are weighted', () => {
    const result = calculateCourseGrade(
      [HW, { ...EX, weight: null }],
      [act('h1', 'hw', 10), act('e1', 'ex', 10)],
      { h1: graded(6), e1: graded(10) },
    );
    expect(result.percent).toBe(60);
  });

  test('nothing marked gives no percent', () => {
    const result = calculateCourseGrade([HW, EX], [act('h1', 'hw', 10)], {});
    expect(result.percent).toBeNull();
  });

  test('only ungrouped marks in a weighted course gives no percent', () => {
    const result = calculateCourseGrade([HW], [act('u1', null, 10)], {
      u1: graded(10),
    });
    expect(result.percent).toBeNull();
  });
});

describe('calculateCourseGrade - unweighted', () => {
  test('total is points earned over points possible', () => {
    const groups = [
      { ...HW, weight: null },
      { ...EX, weight: null },
    ];
    // 8/10 + 45/50 = 53/60
    const result = calculateCourseGrade(
      groups,
      [act('h1', 'hw', 10), act('e1', 'ex', 50)],
      { h1: graded(8), e1: graded(45) },
    );
    expect(result.percent).toBe(88.33);
    expect(result.groups.every((g) => g.weight === null)).toBe(true);
  });

  test('no groups at all: everything is Ungrouped and points-based', () => {
    const result = calculateCourseGrade(
      [],
      [act('a', null, 20), act('b', null, 30)],
      { a: graded(10), b: graded(30) },
    );
    expect(result.percent).toBe(80);
    expect(result.groups).toEqual([
      {
        groupId: null,
        name: 'Ungrouped',
        weight: null,
        earned: 40,
        possible: 50,
        percent: 80,
        dropped: [],
      },
    ]);
  });

  test('ungrouped work counts alongside grouped work', () => {
    const result = calculateCourseGrade(
      [{ ...HW, weight: null }],
      [act('h1', 'hw', 10), act('u1', null, 10)],
      { h1: graded(10), u1: graded(0) },
    );
    expect(result.percent).toBe(50);
  });

  test('an activity whose group is unknown falls into Ungrouped', () => {
    const result = calculateCourseGrade([], [act('a', 'deleted-group', 10)], {
      a: graded(4),
    });
    expect(result.groups[0].groupId).toBeNull();
    expect(result.percent).toBe(40);
  });
});

describe('calculateCourseGrade - what is left out', () => {
  const groups = [{ ...HW, weight: null }];

  test('excused marks leave both score and points out', () => {
    const result = calculateCourseGrade(
      groups,
      [act('a', 'hw', 10), act('b', 'hw', 10)],
      { a: graded(10), b: graded(0, { excused: true }) },
    );
    expect(result.percent).toBe(100);
    expect(result.groups[0].possible).toBe(10);
  });

  test('omitted activities are left out', () => {
    const result = calculateCourseGrade(
      groups,
      [act('a', 'hw', 10), act('b', 'hw', 10, { omitFromFinalGrade: true })],
      { a: graded(10), b: graded(0) },
    );
    expect(result.percent).toBe(100);
  });

  test('ungraded work is ignored, not zero', () => {
    const result = calculateCourseGrade(
      groups,
      [act('a', 'hw', 10), act('b', 'hw', 10)],
      {
        a: graded(5),
        b: { status: 'submitted', score: null, excused: false },
      },
    );
    expect(result.percent).toBe(50);
  });

  test('draft activities are ignored even with a score', () => {
    const result = calculateCourseGrade(
      groups,
      [act('a', 'hw', 10), act('b', 'hw', 10, { status: 'draft' })],
      { a: graded(10), b: graded(0) },
    );
    expect(result.percent).toBe(100);
  });

  test('a draft alone does not create an Ungrouped row', () => {
    const result = calculateCourseGrade(
      groups,
      [act('a', 'hw', 10), act('d', null, 10, { status: 'draft' })],
      { a: graded(10) },
    );
    expect(result.groups.map((g) => g.groupId)).toEqual(['hw']);
  });

  test('accepts a Map of submissions', () => {
    const result = calculateCourseGrade(
      groups,
      [act('a', 'hw', 10)],
      new Map([['a', graded(3)]]),
    );
    expect(result.percent).toBe(30);
  });

  test('groups are listed in position order', () => {
    const result = calculateCourseGrade(
      [
        { ...EX, position: 0 },
        { ...HW, position: 1 },
      ],
      [],
      {},
    );
    expect(result.groups.map((g) => g.groupId)).toEqual(['ex', 'hw']);
  });
});

describe('drop rules', () => {
  const Q: CalcGroup = { id: 'q', name: 'Quizzes', weight: null, position: 0 };

  test('drop lowest 1 leaves out the worst mark', () => {
    const result = calculateCourseGrade(
      [{ ...Q, dropLowest: 1 }],
      [act('a', 'q', 10), act('b', 'q', 10), act('c', 'q', 10)],
      { a: graded(9), b: graded(2), c: graded(7) },
    );
    expect(result.dropped).toEqual(['b']);
    expect(result.groups[0]).toMatchObject({
      earned: 16,
      possible: 20,
      percent: 80,
      dropped: ['b'],
    });
    expect(result.percent).toBe(80);
  });

  test('unequal points: drops what raises the percentage most', () => {
    // 1/2 is the lowest percentage (50%), but dropping 20/50 (40%) leaves
    // 101/102 = 99.02%, while dropping 1/2 leaves 120/150 = 80%.
    const result = calculateCourseGrade(
      [{ ...Q, dropLowest: 1 }],
      [act('a', 'q', 100), act('b', 'q', 2), act('c', 'q', 50)],
      { a: graded(100), b: graded(1), c: graded(20) },
    );
    expect(result.dropped).toEqual(['c']);
    expect(result.percent).toBe(99.02);
  });

  test('a big low mark can be worth dropping over a small zero', () => {
    // Dropping 0/1 leaves 60/100 = 60%; dropping 60/100 leaves 0/1.
    // The first is better, but dropping 0/1 vs 50/100 differ: keep the best.
    const result = calculateCourseGrade(
      [{ ...Q, dropLowest: 1 }],
      [act('a', 'q', 100), act('b', 'q', 1), act('c', 'q', 100)],
      { a: graded(90), b: graded(0), c: graded(40) },
    );
    // keep a+b: 90/101 = 89.1%; keep a+c: 130/200 = 65%.
    expect(result.dropped).toEqual(['c']);
    expect(result.percent).toBe(89.11);
  });

  test('never drops every counted mark', () => {
    const result = calculateCourseGrade(
      [{ ...Q, dropLowest: 5 }],
      [act('a', 'q', 10), act('b', 'q', 10)],
      { a: graded(3), b: graded(8) },
    );
    expect(result.dropped).toEqual(['a']);
    expect(result.percent).toBe(80);
  });

  test('with one counted mark nothing is dropped', () => {
    const result = calculateCourseGrade(
      [{ ...Q, dropLowest: 1 }],
      [act('a', 'q', 10), act('b', 'q', 10)],
      { a: graded(3) },
    );
    expect(result.dropped).toEqual([]);
    expect(result.percent).toBe(30);
  });

  test('ungraded, excused and omitted work is not a drop candidate', () => {
    const result = calculateCourseGrade(
      [{ ...Q, dropLowest: 1 }],
      [
        act('a', 'q', 10),
        act('b', 'q', 10),
        act('c', 'q', 10, { omitFromFinalGrade: true }),
        act('d', 'q', 10),
        act('e', 'q', 10),
      ],
      {
        a: graded(6),
        b: graded(9),
        c: graded(0),
        d: graded(0, { excused: true }),
        e: { status: 'submitted', score: null, excused: false },
      },
    );
    expect(result.dropped).toEqual(['a']);
    expect(result.percent).toBe(90);
  });

  test('drop highest removes the best mark after the lowest go', () => {
    const result = calculateCourseGrade(
      [{ ...Q, dropLowest: 1, dropHighest: 1 }],
      [act('a', 'q', 10), act('b', 'q', 10), act('c', 'q', 10), act('d', 'q', 10)],
      { a: graded(10), b: graded(2), c: graded(7), d: graded(6) },
    );
    expect(result.dropped.sort()).toEqual(['a', 'b']);
    expect(result.percent).toBe(65);
  });

  test('drop highest alone, and never past the last mark', () => {
    const result = calculateCourseGrade(
      [{ ...Q, dropHighest: 3 }],
      [act('a', 'q', 10), act('b', 'q', 10)],
      { a: graded(10), b: graded(4) },
    );
    expect(result.dropped).toEqual(['a']);
    expect(result.percent).toBe(40);
  });

  test('drops are per group and do not touch other groups or Ungrouped', () => {
    const result = calculateCourseGrade(
      [
        { ...HW, dropLowest: 1 },
        { ...EX, dropLowest: 0 },
      ],
      [
        act('h1', 'hw', 10),
        act('h2', 'hw', 10),
        act('e1', 'ex', 10),
        act('e2', 'ex', 10),
        act('u1', null, 10),
        act('u2', null, 10),
      ],
      {
        h1: graded(10),
        h2: graded(0),
        e1: graded(5),
        e2: graded(0),
        u1: graded(0),
        u2: graded(10),
      },
    );
    expect(result.dropped).toEqual(['h2']);
    const hw = result.groups.find((g) => g.groupId === 'hw')!;
    const ex = result.groups.find((g) => g.groupId === 'ex')!;
    expect(hw.percent).toBe(100);
    expect(ex.percent).toBe(25);
    // Weighted 40/60 over Homework and Exams; Ungrouped weighs nothing.
    expect(result.percent).toBe(55);
  });

  test('drops apply before an unweighted course sums its points', () => {
    const result = calculateCourseGrade(
      [{ ...Q, dropLowest: 1 }, { id: 'o', name: 'Other', weight: null, position: 1 }],
      [act('a', 'q', 10), act('b', 'q', 10), act('o1', 'o', 20)],
      { a: graded(0), b: graded(10), o1: graded(10) },
    );
    // 10/10 + 10/20 = 20/30.
    expect(result.percent).toBe(66.67);
  });

  test('ties keep the earlier activity', () => {
    const { dropped } = applyDrops(
      [
        { id: 'a', earned: 5, possible: 10 },
        { id: 'b', earned: 5, possible: 10 },
        { id: 'c', earned: 9, possible: 10 },
      ],
      1,
      0,
    );
    expect(dropped).toEqual(['b']);
  });

  test('zero-point work is never all that is left', () => {
    const { dropped } = applyDrops(
      [
        { id: 'xc', earned: 2, possible: 0 },
        { id: 'a', earned: 3, possible: 10 },
      ],
      1,
      0,
    );
    // Keeping only the extra credit has no percentage at all.
    expect(dropped).toEqual(['xc']);
  });

  test('negative or fractional counts are treated sensibly', () => {
    const items = [
      { id: 'a', earned: 1, possible: 10 },
      { id: 'b', earned: 9, possible: 10 },
    ];
    expect(applyDrops(items, -2, 0).dropped).toEqual([]);
    expect(applyDrops(items, 1.7, 0).dropped).toEqual(['a']);
  });

  test('the large-case search agrees with brute force', () => {
    // Deterministic pseudo-random marks, small enough to brute force, run
    // through the exhaustive path (bestSubset) and the ratio search alike.
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const ratio = (xs: DropItem[]) =>
      xs.reduce((s, x) => s + x.earned, 0) /
      xs.reduce((s, x) => s + x.possible, 0);

    for (let trial = 0; trial < 40; trial++) {
      const n = 6 + Math.floor(rand() * 4);
      const items: DropItem[] = Array.from({ length: n }, (_, i) => {
        const possible = 1 + Math.floor(rand() * 100);
        return { id: `i${i}`, possible, earned: Math.floor(rand() * (possible + 1)) };
      });
      for (const drop of [1, 2, 3]) {
        const keep = n - drop;
        // Brute force every subset of size `keep`.
        let bestHigh = -Infinity;
        let bestLow = Infinity;
        for (let mask = 0; mask < 1 << n; mask++) {
          const subset = items.filter((_, i) => mask & (1 << i));
          if (subset.length !== keep) continue;
          bestHigh = Math.max(bestHigh, ratio(subset));
          bestLow = Math.min(bestLow, ratio(subset));
        }
        expect(ratio(bestSubset(items, keep, 1))).toBeCloseTo(bestHigh, 9);
        expect(ratio(bestSubset(items, keep, -1))).toBeCloseTo(bestLow, 9);
        expect(ratio(ratioSearchSubset(items, keep, 1))).toBeCloseTo(bestHigh, 9);
        expect(ratio(ratioSearchSubset(items, keep, -1))).toBeCloseTo(bestLow, 9);
      }
    }
  });

  test('many marks with several drops stays exact and fast', () => {
    // C(40, 5) is far past the exhaustive limit, so this takes the ratio
    // search; check it against the known answer for a simple shape.
    const items: DropItem[] = Array.from({ length: 40 }, (_, i) => ({
      id: `i${i}`,
      earned: i < 5 ? 0 : 8,
      possible: 10,
    }));
    const { dropped } = applyDrops(items, 5, 0);
    expect(dropped.sort()).toEqual(['i0', 'i1', 'i2', 'i3', 'i4']);
  });
});

describe('letterFor', () => {
  const bands = [
    { label: 'A', minPercentage: 90, maxPercentage: 100 },
    { label: 'B', minPercentage: 80, maxPercentage: 89 },
    { label: 'F', minPercentage: 0, maxPercentage: 79 },
  ];

  test('picks the band the percent falls in', () => {
    expect(letterFor(bands, 95)).toBe('A');
    expect(letterFor(bands, 80)).toBe('B');
    expect(letterFor(bands, 12)).toBe('F');
  });

  test('a percent in the gap between whole-number bands takes the lower band', () => {
    expect(letterFor(bands, 89.5)).toBe('B');
  });

  test('no percent or no scale gives no letter', () => {
    expect(letterFor(bands, null)).toBeNull();
    expect(letterFor([], 90)).toBeNull();
  });
});
