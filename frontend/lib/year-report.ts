import { api } from "./api";
import type {
  ClassSummary,
  ClassSummarySubjectAvg,
  ClassSummaryStudent,
  StudentSubjectGrade,
} from "./reports";

export interface YearTermGrade {
  termId: string;
  termName: string;
  termComposite: number | null;
}

export interface YearEndSubjectResult {
  subjectId: string;
  subjectName: string;
  yearGrade: number | null;
  termGrades: YearTermGrade[];
}

export interface YearTermDetail {
  termId: string;
  termName: string;
  subjects: {
    subjectId: string;
    subjectName: string;
    subjectCode: string | null;
    isGraded: boolean;
    courseworkAverage: number | null;
    examAverage: number | null;
    termComposite: number | null;
  }[];
  overallAverage: number | null;
}

export interface StudentYearReport {
  studentId: string;
  firstName: string;
  lastName: string;
  academicYearId: string;
  gradingModel: "term_based" | "year_based";
  terms: YearTermDetail[];
  yearEnd: {
    subjects: YearEndSubjectResult[];
    overallAverage: number | null;
  };
  position?: number;
}

export interface StudentTermResult {
  studentId: string;
  firstName: string;
  lastName: string;
  termId: string;
  subjects: {
    subjectId: string;
    subjectName: string;
    subjectCode: string | null;
    isGraded: boolean;
    courseworkAverage: number | null;
    examAverage: number | null;
    termComposite: number | null;
  }[];
  overallAverage: number | null;
  position?: number;
}

export function getStudentTermResult(
  studentId: string,
  termId: string,
  studentGroupId: string,
) {
  const q = new URLSearchParams({ studentId, termId, studentGroupId });
  return api<StudentTermResult>(
    `/calculations/student-term?${q.toString()}`,
  );
}

export function getClassTermResults(
  termId: string,
  studentGroupId: string,
) {
  const q = new URLSearchParams({ termId, studentGroupId });
  return api<StudentTermResult[]>(
    `/calculations/class-term?${q.toString()}`,
  );
}

export function getStudentYearResult(
  studentId: string,
  academicYearId: string,
  studentGroupId: string,
) {
  const q = new URLSearchParams({ studentId, academicYearId, studentGroupId });
  return api<StudentYearReport>(
    `/calculations/student-year?${q.toString()}`,
  );
}

export function getClassYearResults(
  academicYearId: string,
  studentGroupId: string,
) {
  const q = new URLSearchParams({ academicYearId, studentGroupId });
  return api<StudentYearReport[]>(
    `/calculations/class-year?${q.toString()}`,
  );
}

const PASS_THRESHOLD = 50;

/**
 * Build a ClassSummary from live StudentTermResult[] so the existing
 * PDF / CSV / XLSX export functions can consume it without change.
 */
export function termResultsToClassSummary(
  results: StudentTermResult[],
  opts: { courseworkWeight: number; examWeight: number; gradingModel?: string },
): ClassSummary {
  const subjectMap = new Map<string, { name: string; totals: number[]; all: number[] }>();

  const students: ClassSummaryStudent[] = results.map((r) => {
    const subjects: StudentSubjectGrade[] = r.subjects.map((s) => {
      let entry = subjectMap.get(s.subjectId);
      if (!entry) {
        entry = { name: s.subjectName, totals: [], all: [] };
        subjectMap.set(s.subjectId, entry);
      }
      if (s.termComposite != null) {
        entry.totals.push(s.termComposite);
        entry.all.push(s.termComposite);
      }
      return {
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        courseworkAverage: s.courseworkAverage,
        examAverage: s.examAverage,
        termComposite: s.termComposite,
        yearGrade: null,
      };
    });

    return {
      studentId: r.studentId,
      firstName: r.firstName,
      lastName: r.lastName,
      overallAverage: r.overallAverage,
      position: r.position ?? null,
      subjects,
    };
  });

  const averages = students
    .map((s) => s.overallAverage)
    .filter((v): v is number => v != null);

  const classAverage =
    averages.length > 0 ? averages.reduce((a, b) => a + b, 0) / averages.length : null;
  const highestAverage = averages.length > 0 ? Math.max(...averages) : null;
  const lowestAverage = averages.length > 0 ? Math.min(...averages) : null;
  const passCount = averages.filter((v) => v >= PASS_THRESHOLD).length;
  const failCount = averages.filter((v) => v < PASS_THRESHOLD).length;

  const subjectAverages: ClassSummarySubjectAvg[] = [...subjectMap.entries()].map(
    ([id, entry]) => ({
      subjectId: id,
      subjectName: entry.name,
      average:
        entry.totals.length > 0
          ? entry.totals.reduce((a, b) => a + b, 0) / entry.totals.length
          : null,
      highestMark: entry.all.length > 0 ? Math.max(...entry.all) : null,
      lowestMark: entry.all.length > 0 ? Math.min(...entry.all) : null,
    }),
  );

  return {
    classAverage,
    highestAverage,
    lowestAverage,
    totalStudents: results.length,
    passCount,
    failCount,
    courseworkWeight: opts.courseworkWeight,
    examWeight: opts.examWeight,
    gradingModel: opts.gradingModel ?? "term_based",
    subjectAverages,
    students,
  };
}
