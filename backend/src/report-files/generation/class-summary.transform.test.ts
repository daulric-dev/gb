import { describe, test, expect } from 'bun:test';
import { termResultsToClassSummary } from './class-summary.transform';
import type { StudentTermResult } from '@/calculation/interfaces/calculation.interfaces';

function subject(
  subjectId: string,
  subjectName: string,
  termComposite: number | null,
  courseworkAverage: number | null = null,
  examAverage: number | null = null,
) {
  return {
    subjectId,
    subjectName,
    subjectCode: null,
    isGraded: true,
    courseworkAverage,
    examAverage,
    termComposite,
    gradeCount: 1,
    assessments: [],
  };
}

function student(
  studentId: string,
  firstName: string,
  overallAverage: number | null,
  subjects: StudentTermResult['subjects'],
  position?: number,
): StudentTermResult {
  return {
    studentId,
    firstName,
    lastName: 'Test',
    termId: 't1',
    subjects,
    overallAverage,
    position,
  };
}

describe('termResultsToClassSummary', () => {
  const results: StudentTermResult[] = [
    student(
      's1',
      'Alice',
      80,
      [subject('m', 'Math', 80), subject('e', 'English', 80)],
      1,
    ),
    student(
      's2',
      'Bob',
      40,
      [subject('m', 'Math', 40), subject('e', 'English', 40)],
      2,
    ),
  ];

  test('computes class average, high/low and pass/fail', () => {
    const summary = termResultsToClassSummary(results, {
      courseworkWeight: 60,
      examWeight: 40,
    });
    expect(summary.totalStudents).toBe(2);
    expect(summary.classAverage).toBe(60);
    expect(summary.highestAverage).toBe(80);
    expect(summary.lowestAverage).toBe(40);
    expect(summary.passCount).toBe(1); // Alice (80) passes, Bob (40) fails
    expect(summary.failCount).toBe(1);
    expect(summary.courseworkWeight).toBe(60);
    expect(summary.examWeight).toBe(40);
  });

  test('aggregates per-subject averages across students', () => {
    const summary = termResultsToClassSummary(results, {
      courseworkWeight: 60,
      examWeight: 40,
    });
    const math = summary.subjectAverages.find((s) => s.subjectId === 'm');
    expect(math).toBeDefined();
    expect(math!.average).toBe(60); // (80 + 40) / 2
    expect(math!.highestMark).toBe(80);
    expect(math!.lowestMark).toBe(40);
  });

  test('defaults grading model and handles empty input', () => {
    const empty = termResultsToClassSummary([], {
      courseworkWeight: 50,
      examWeight: 50,
    });
    expect(empty.gradingModel).toBe('weighted_continuous');
    expect(empty.classAverage).toBeNull();
    expect(empty.passCount).toBe(0);
    expect(empty.students).toEqual([]);
  });
});
