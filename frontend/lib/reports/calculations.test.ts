import { describe, test, expect } from "bun:test";
import {
  termResultsToClassSummary,
  type StudentTermResult,
} from "@/lib/reports/calculations";

const defaultOpts = { courseworkWeight: 40, examWeight: 60 };

function makeStudent(
  overrides: Partial<StudentTermResult> & { studentId: string },
): StudentTermResult {
  return {
    firstName: "Test",
    lastName: "User",
    termId: "t1",
    subjects: [],
    overallAverage: null,
    ...overrides,
  };
}

describe("termResultsToClassSummary", () => {
  test("empty results returns all nulls/zeros", () => {
    const summary = termResultsToClassSummary([], defaultOpts);

    expect(summary.classAverage).toBeNull();
    expect(summary.highestAverage).toBeNull();
    expect(summary.lowestAverage).toBeNull();
    expect(summary.totalStudents).toBe(0);
    expect(summary.passCount).toBe(0);
    expect(summary.failCount).toBe(0);
    expect(summary.subjectAverages).toEqual([]);
    expect(summary.students).toEqual([]);
  });

  test("single student computes correct class average and pass/fail", () => {
    const student = makeStudent({
      studentId: "s1",
      firstName: "Alice",
      lastName: "Smith",
      overallAverage: 72,
      subjects: [
        {
          subjectId: "sub1",
          subjectName: "Math",
          subjectCode: null,
          isGraded: true,
          courseworkAverage: 80,
          examAverage: 65,
          termComposite: 72,
        },
      ],
    });

    const summary = termResultsToClassSummary([student], defaultOpts);

    expect(summary.classAverage).toBe(72);
    expect(summary.highestAverage).toBe(72);
    expect(summary.lowestAverage).toBe(72);
    expect(summary.totalStudents).toBe(1);
    expect(summary.passCount).toBe(1);
    expect(summary.failCount).toBe(0);
  });

  test("multiple students: class average is mean of overallAverages", () => {
    const students: StudentTermResult[] = [
      makeStudent({ studentId: "s1", overallAverage: 80 }),
      makeStudent({ studentId: "s2", overallAverage: 60 }),
      makeStudent({ studentId: "s3", overallAverage: 70 }),
    ];

    const summary = termResultsToClassSummary(students, defaultOpts);

    expect(summary.classAverage).toBe(70);
    expect(summary.highestAverage).toBe(80);
    expect(summary.lowestAverage).toBe(60);
    expect(summary.totalStudents).toBe(3);
  });

  test("pass threshold: 49.9 is fail, 50 is pass", () => {
    const students: StudentTermResult[] = [
      makeStudent({ studentId: "s1", overallAverage: 49.9 }),
      makeStudent({ studentId: "s2", overallAverage: 50 }),
    ];

    const summary = termResultsToClassSummary(students, defaultOpts);

    expect(summary.passCount).toBe(1);
    expect(summary.failCount).toBe(1);
  });

  test("subject averages computed from termComposite values", () => {
    const students: StudentTermResult[] = [
      makeStudent({
        studentId: "s1",
        overallAverage: 80,
        subjects: [
          {
            subjectId: "sub1",
            subjectName: "Math",
            subjectCode: null,
            isGraded: true,
            courseworkAverage: 85,
            examAverage: 75,
            termComposite: 80,
          },
        ],
      }),
      makeStudent({
        studentId: "s2",
        overallAverage: 60,
        subjects: [
          {
            subjectId: "sub1",
            subjectName: "Math",
            subjectCode: null,
            isGraded: true,
            courseworkAverage: 55,
            examAverage: 65,
            termComposite: 60,
          },
        ],
      }),
    ];

    const summary = termResultsToClassSummary(students, defaultOpts);

    expect(summary.subjectAverages).toHaveLength(1);
    expect(summary.subjectAverages[0].subjectId).toBe("sub1");
    expect(summary.subjectAverages[0].average).toBe(70);
  });

  test("subject averages include correct highestMark and lowestMark", () => {
    const students: StudentTermResult[] = [
      makeStudent({
        studentId: "s1",
        overallAverage: 90,
        subjects: [
          {
            subjectId: "sub1",
            subjectName: "Math",
            subjectCode: null,
            isGraded: true,
            courseworkAverage: 90,
            examAverage: 90,
            termComposite: 90,
          },
        ],
      }),
      makeStudent({
        studentId: "s2",
        overallAverage: 55,
        subjects: [
          {
            subjectId: "sub1",
            subjectName: "Math",
            subjectCode: null,
            isGraded: true,
            courseworkAverage: 50,
            examAverage: 60,
            termComposite: 55,
          },
        ],
      }),
    ];

    const summary = termResultsToClassSummary(students, defaultOpts);

    expect(summary.subjectAverages[0].highestMark).toBe(90);
    expect(summary.subjectAverages[0].lowestMark).toBe(55);
  });

  test("gradingModel defaults to 'weighted_continuous' when not provided", () => {
    const summary = termResultsToClassSummary([], defaultOpts);
    expect(summary.gradingModel).toBe("weighted_continuous");
  });

  test("gradingModel uses provided value", () => {
    const summary = termResultsToClassSummary([], {
      ...defaultOpts,
      gradingModel: "weighted_cumulative",
    });
    expect(summary.gradingModel).toBe("weighted_cumulative");
  });
});
