import { describe, test, expect } from 'bun:test';
import {
  CalcActivity,
  CalcGroup,
  CalcSubmission,
  calculateCourseGrade,
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
      },
      {
        groupId: 'ex',
        name: 'Exams',
        weight: 60,
        earned: 45,
        possible: 50,
        percent: 90,
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
