import type { StudentTermResult } from '@/calculation/interfaces/calculation.interfaces';

/**
 * Class-summary shapes + the pure aggregation transform, ported verbatim from
 * the frontend (frontend/lib/reports/{api,calculations}.ts). This aggregates
 * already-computed per-student results into class-level statistics; it does NOT
 * recompute grades — CalculationService remains the source of truth.
 */

export interface ClassSummarySubjectAvg {
  subjectId: string;
  subjectName: string;
  average: number | null;
  highestMark: number | null;
  lowestMark: number | null;
}

export interface StudentSubjectGrade {
  subjectId: string;
  subjectName: string;
  courseworkAverage: number | null;
  examAverage: number | null;
  termComposite: number | null;
  yearGrade: number | null;
}

export interface ClassSummaryStudent {
  studentId: string;
  firstName: string;
  lastName: string;
  overallAverage: number | null;
  position: number | null;
  subjects: StudentSubjectGrade[];
}

export interface ClassSummary {
  classAverage: number | null;
  highestAverage: number | null;
  lowestAverage: number | null;
  totalStudents: number;
  passCount: number;
  failCount: number;
  courseworkWeight: number;
  examWeight: number;
  gradingModel: string;
  subjectAverages: ClassSummarySubjectAvg[];
  students: ClassSummaryStudent[];
}

const PASS_THRESHOLD = 50;

export function termResultsToClassSummary(
  results: StudentTermResult[],
  opts: { courseworkWeight: number; examWeight: number; gradingModel?: string },
): ClassSummary {
  const subjectMap = new Map<
    string,
    { name: string; totals: number[]; all: number[] }
  >();

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
    averages.length > 0
      ? averages.reduce((a, b) => a + b, 0) / averages.length
      : null;
  const highestAverage = averages.length > 0 ? Math.max(...averages) : null;
  const lowestAverage = averages.length > 0 ? Math.min(...averages) : null;
  const passCount = averages.filter((v) => v >= PASS_THRESHOLD).length;
  const failCount = averages.filter((v) => v < PASS_THRESHOLD).length;

  const subjectAverages: ClassSummarySubjectAvg[] = [
    ...subjectMap.entries(),
  ].map(([id, entry]) => ({
    subjectId: id,
    subjectName: entry.name,
    average:
      entry.totals.length > 0
        ? entry.totals.reduce((a, b) => a + b, 0) / entry.totals.length
        : null,
    highestMark: entry.all.length > 0 ? Math.max(...entry.all) : null,
    lowestMark: entry.all.length > 0 ? Math.min(...entry.all) : null,
  }));

  return {
    classAverage,
    highestAverage,
    lowestAverage,
    totalStudents: results.length,
    passCount,
    failCount,
    courseworkWeight: opts.courseworkWeight,
    examWeight: opts.examWeight,
    gradingModel: opts.gradingModel ?? 'weighted_continuous',
    subjectAverages,
    students,
  };
}
