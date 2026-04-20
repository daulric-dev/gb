import { describe, test, expect } from "bun:test";
import type { StudentYearReport } from "@/lib/reports/calculations";
import { buildYearClassSummaryCsv } from "@/lib/reports/year-export";

const students: StudentYearReport[] = [
  {
    studentId: "s1",
    firstName: "Alice",
    lastName: "Smith",
    academicYearId: "y1",
    gradingModel: "year_based",
    position: 1,
    terms: [
      {
        termId: "t1",
        termName: "Michaelmas",
        subjects: [
          {
            subjectId: "sub1",
            subjectName: "Math",
            subjectCode: null,
            isGraded: true,
            courseworkAverage: 80,
            examAverage: 70,
            termComposite: 75,
          },
        ],
        overallAverage: 75,
      },
      {
        termId: "t2",
        termName: "Hilary",
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
        overallAverage: 80,
      },
    ],
    yearEnd: {
      subjects: [
        {
          subjectId: "sub1",
          subjectName: "Math",
          yearGrade: 77.5,
          termGrades: [
            { termId: "t1", termName: "Michaelmas", termComposite: 75 },
            { termId: "t2", termName: "Hilary", termComposite: 80 },
          ],
        },
      ],
      overallAverage: 77.5,
    },
  },
];

describe("buildYearClassSummaryCsv", () => {
  test("CSV contains 'Year-End Class Summary Report'", async () => {
    const blob = buildYearClassSummaryCsv(students, "Grade 10A");
    const text = await blob.text();

    expect(text).toContain("Year-End Class Summary Report");
  });

  test("CSV contains class name", async () => {
    const blob = buildYearClassSummaryCsv(students, "Grade 10A");
    const text = await blob.text();

    expect(text).toContain("Grade 10A");
  });

  test("CSV contains academic year name when provided", async () => {
    const blob = buildYearClassSummaryCsv(students, "Grade 10A", {
      academicYearName: "2024-2025",
    });
    const text = await blob.text();

    expect(text).toContain("2024-2025");
  });

  test("CSV includes term initials as column headers", async () => {
    const blob = buildYearClassSummaryCsv(students, "Grade 10A");
    const text = await blob.text();

    expect(text).toContain('"M"');
    expect(text).toContain('"H"');
  });

  test("CSV contains student data row", async () => {
    const blob = buildYearClassSummaryCsv(students, "Grade 10A");
    const text = await blob.text();

    expect(text).toContain("Alice Smith");
    expect(text).toContain("77.50");
  });
});
