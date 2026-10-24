import { describe, test, expect } from 'bun:test';
import {
  ImportActivity,
  ImportCurrent,
  ImportStudent,
  parseCsv,
  planImport,
} from './gradebook-import';
import { csvCell } from './gradebook.service';

/**
 * CSV import planning: what a sheet would change, and every reason a row or
 * cell is refused. Apply re-runs this same plan, so it is the whole rule set.
 */

const ACTS: ImportActivity[] = [
  { id: 'a1', title: 'Essay', points: 10, kind: 'assignment' },
  { id: 'q1', title: 'Quiz 1', points: 3, kind: 'quiz' },
  { id: 'f1', title: '=Field trip', points: 20, kind: 'offline' },
];

const STUDENTS: ImportStudent[] = [
  { id: 'stu-1', firstName: 'Ann', lastName: 'Adams', email: 'ann@x.test' },
  { id: 'stu-2', firstName: 'Bo', lastName: 'Brown', email: null },
  { id: 'stu-3', firstName: 'Cy', lastName: 'Cole', email: null },
  { id: 'stu-4', firstName: 'Cy', lastName: 'Cole', email: 'cy4@x.test' },
];

function current(
  entries: Record<string, ImportCurrent> = {},
): Map<string, ImportCurrent> {
  return new Map(Object.entries(entries));
}

const row = (...cells: string[]) => cells.map(csvCell).join(',');

describe('parseCsv', () => {
  test('quotes, doubled quotes, CRLF, BOM and blank lines', () => {
    const rows = parseCsv('﻿a,"b, c","say ""hi"""\r\n\r\n1,2,3\n');
    expect(rows).toEqual([
      { line: 1, cells: ['a', 'b, c', 'say "hi"'] },
      { line: 3, cells: ['1', '2', '3'] },
    ]);
  });

  test('a quoted newline stays in its cell', () => {
    const rows = parseCsv('a,"x\ny"\nb,z');
    expect(rows[0].cells).toEqual(['a', 'x\ny']);
    expect(rows[1]).toEqual({ line: 3, cells: ['b', 'z'] });
  });
});

describe('planImport', () => {
  const HEAD = row(
    'Last name',
    'First name',
    'Student ID',
    'Status',
    'Essay (10)',
    'Quiz 1 (3)',
    '=Field trip (20)',
    'Homework %',
    'Total %',
    'Letter',
  );

  test('an untouched export changes nothing', () => {
    const csv = [
      HEAD,
      row('Adams', 'Ann', 'stu-1', 'active', '9', '2.67', 'EX', '90', '90', 'A'),
      row('Brown', 'Bo', 'stu-2', 'active', '', '', '', '', '', ''),
    ].join('\r\n');
    const plan = planImport(
      csv,
      ACTS,
      STUDENTS,
      current({
        'stu-1:a1': { score: 9, excused: false },
        // A quiz's auto score at full precision, exported at two decimals.
        'stu-1:q1': { score: 8 / 3, excused: false },
        'stu-1:f1': { score: 12, excused: true },
      }),
    );
    expect(plan.errors).toEqual([]);
    expect(plan.changes).toEqual([]);
    expect(plan.matchedRows).toBe(2);
    expect(plan.columns.filter((c) => c.status === 'activity').length).toBe(3);
    expect(
      plan.columns.find((c) => c.header === '=Field trip (20)')?.activityId,
    ).toBe('f1');
  });

  test('new and changed marks, excusing, and lifting an excuse', () => {
    const csv = [
      HEAD,
      row('Adams', 'Ann', 'stu-1', '', '7.5', '3', 'EX'),
      row('Brown', 'Bo', 'stu-2', '', '10', '', '15'),
    ].join('\n');
    const plan = planImport(
      csv,
      ACTS,
      STUDENTS,
      current({
        'stu-1:a1': { score: 9, excused: false },
        'stu-2:f1': { score: 4, excused: true },
      }),
    );
    expect(plan.errors).toEqual([]);
    expect(
      plan.changes.map((c) => [c.studentId, c.activityId, c.to]),
    ).toEqual([
      ['stu-1', 'a1', { score: 7.5, excused: false }],
      ['stu-1', 'q1', { score: 3, excused: false }],
      ['stu-1', 'f1', { score: null, excused: true }],
      ['stu-2', 'a1', { score: 10, excused: false }],
      ['stu-2', 'f1', { score: 15, excused: false }],
    ]);
    expect(plan.changes[0].from).toEqual({ score: 9, excused: false });
    expect(plan.unchanged).toBe(1);
  });

  test('validates range and decimals per cell', () => {
    const csv = [
      HEAD,
      row('Adams', 'Ann', 'stu-1', '', '11', '-1', '1.234'),
      row('Brown', 'Bo', 'stu-2', '', 'abc', '.5', '20'),
    ].join('\n');
    const plan = planImport(csv, ACTS, STUDENTS, current());
    expect(plan.errors.map((e) => [e.line, e.column])).toEqual([
      [2, 'Essay (10)'],
      [2, 'Quiz 1 (3)'],
      [2, '=Field trip (20)'],
      [3, 'Essay (10)'],
    ]);
    expect(plan.changes.map((c) => c.to.score)).toEqual([0.5, 20]);
  });

  test('matches by name and email when there is no Student ID', () => {
    const csv = [
      'Last name,First name,Email,Essay',
      ' adams , ANN ,,5',
      'Cole,Cy,cy4@x.test,6',
      'Cole,Cy,,7',
      'Nobody,Here,,1',
    ].join('\n');
    const plan = planImport(csv, ACTS, STUDENTS, current());
    expect(plan.changes.map((c) => [c.studentId, c.to.score])).toEqual([
      ['stu-1', 5],
      ['stu-4', 6],
    ]);
    expect(plan.errors.map((e) => e.line)).toEqual([4, 5]);
    expect(plan.errors[0].message).toContain('More than one student');
  });

  test('an unknown Student ID or a repeated student is a row error', () => {
    const csv = [
      'Student ID,Essay (10)',
      'stu-9,5',
      'stu-1,5',
      'STU-1,6',
    ].join('\n');
    const plan = planImport(csv, ACTS, STUDENTS, current());
    expect(plan.errors.map((e) => e.line)).toEqual([2, 4]);
    expect(plan.changes.length).toBe(1);
  });

  test('a sheet with no student or activity columns is refused', () => {
    expect(
      planImport('Essay (10)\n5', ACTS, STUDENTS, current()).errors[0].message,
    ).toContain('Student ID');
    expect(
      planImport('Student ID,Total %\nstu-1,5', ACTS, STUDENTS, current())
        .errors[0].message,
    ).toContain('No column');
    expect(planImport('', ACTS, STUDENTS, current()).errors.length).toBe(1);
  });

  test('two activities with the same title are ambiguous by title', () => {
    const acts: ImportActivity[] = [
      { id: 'x1', title: 'Lab', points: 10, kind: 'offline' },
      { id: 'x2', title: 'Lab', points: 10, kind: 'offline' },
    ];
    const plan = planImport('Student ID,Lab (10)\nstu-1,5', acts, STUDENTS, current());
    expect(plan.columns[1].status).toBe('ambiguous');
    expect(plan.errors.length).toBeGreaterThan(0);
  });

  test('a bare title matches when it names one activity', () => {
    const plan = planImport('Student ID,essay\nstu-1,4', ACTS, STUDENTS, current());
    expect(plan.changes.map((c) => c.activityId)).toEqual(['a1']);
  });
});
