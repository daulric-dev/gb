import { describe, test, expect } from "bun:test";
import type { StudentYearReport } from "@/lib/reports/calculations";
import { yearReportPdfFilename } from "@/lib/reports/year-pdf";

function stubReport(firstName: string, lastName: string): StudentYearReport {
  return {
    studentId: "s1",
    firstName,
    lastName,
    academicYearId: "y1",
    gradingModel: "weighted_cumulative",
    terms: [],
    yearEnd: { subjects: [], overallAverage: null },
  };
}

describe("yearReportPdfFilename", () => {
  test("basic name generates correct filename", () => {
    const result = yearReportPdfFilename(stubReport("Alice", "Smith"));
    expect(result).toBe("Alice_Smith_year_report.pdf");
  });

  test("spaces in names are replaced with underscores", () => {
    const result = yearReportPdfFilename(stubReport("Mary Jane", "Van Der Berg"));
    expect(result).toBe("Mary_Jane_Van_Der_Berg_year_report.pdf");
  });

  test("handles consecutive spaces", () => {
    const result = yearReportPdfFilename(stubReport("Anna  Marie", "De  La  Cruz"));
    expect(result).toBe("Anna_Marie_De_La_Cruz_year_report.pdf");
  });
});
