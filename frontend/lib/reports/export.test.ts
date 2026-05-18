import { describe, test, expect } from "bun:test";
import type { ClassSummary } from "@/lib/reports/api";
import { buildClassSummaryCsv } from "@/lib/reports/export";

const summary: ClassSummary = {
  classAverage: 75.5,
  highestAverage: 90,
  lowestAverage: 60,
  totalStudents: 2,
  passCount: 2,
  failCount: 0,
  courseworkWeight: 40,
  examWeight: 60,
  gradingModel: "weighted_continuous",
  subjectAverages: [
    {
      subjectId: "s1",
      subjectName: "Math",
      average: 75,
      highestMark: 90,
      lowestMark: 60,
    },
  ],
  students: [
    {
      studentId: "st1",
      firstName: "Alice",
      lastName: "Smith",
      overallAverage: 90,
      position: 1,
      subjects: [
        {
          subjectId: "s1",
          subjectName: "Math",
          courseworkAverage: 85,
          examAverage: 95,
          termComposite: 90,
          yearGrade: null,
        },
      ],
    },
    {
      studentId: "st2",
      firstName: "Bob",
      lastName: "Jones",
      overallAverage: 60,
      position: 2,
      subjects: [
        {
          subjectId: "s1",
          subjectName: "Math",
          courseworkAverage: 55,
          examAverage: 65,
          termComposite: 60,
          yearGrade: null,
        },
      ],
    },
  ],
};

describe("buildClassSummaryCsv", () => {
  test("CSV contains class name", async () => {
    const blob = buildClassSummaryCsv(summary, "Grade 10A");
    const text = await blob.text();

    expect(text).toContain("Grade 10A");
  });

  test("CSV contains term name when provided", async () => {
    const blob = buildClassSummaryCsv(summary, "Grade 10A", undefined, "Michaelmas");
    const text = await blob.text();

    expect(text).toContain("Michaelmas");
  });

  test("CSV contains correct total students count", async () => {
    const blob = buildClassSummaryCsv(summary, "Grade 10A");
    const text = await blob.text();

    expect(text).toContain("Total Students,2");
  });

  test("CSV contains subject columns", async () => {
    const blob = buildClassSummaryCsv(summary, "Grade 10A");
    const text = await blob.text();

    expect(text).toContain("Math");
    expect(text).toContain("CW (40%)");
    expect(text).toContain("EX (60%)");
  });

  test("CSV contains student rows with position and name", async () => {
    const blob = buildClassSummaryCsv(summary, "Grade 10A");
    const text = await blob.text();

    expect(text).toContain("Alice Smith");
    expect(text).toContain("Bob Jones");
    const lines = text.split("\n");
    const aliceLine = lines.find((l) => l.includes("Alice Smith"));
    expect(aliceLine).toBeDefined();
    expect(aliceLine!).toMatch(/^1,/);
  });

  test("year-end report uses 'Year' labels instead of 'Term'/'Final'", async () => {
    const yearSummary: ClassSummary = {
      ...summary,
      gradingModel: "weighted_cumulative",
    };
    const blob = buildClassSummaryCsv(yearSummary, "Grade 10A", "year_end");
    const text = await blob.text();

    expect(text).toContain("Year Coursework Weight");
    expect(text).toContain("Year Exam Weight");
    expect(text).not.toContain("Term Coursework Weight");
  });
});
