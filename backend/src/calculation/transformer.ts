import type {
  StudentTermResult,
  StudentYearResult,
} from './interfaces/calculation.interfaces';

export interface ClassSummaryItem {
  student: { id: string; firstName: string; lastName: string };
  subjects: { subjectId: string; subjectName: string; average: number | null }[];
  overallAverage: number | null;
  position?: number;
}

export function v1StudentTermResult(raw: StudentTermResult): StudentTermResult {
  return raw;
}

export function v1StudentYearResult(raw: StudentYearResult): StudentYearResult {
  return raw;
}

export function v1ClassTermResults(data: StudentTermResult[]): StudentTermResult[] {
  return data;
}

export function v1ClassYearResults(data: StudentYearResult[]): StudentYearResult[] {
  return data;
}

export function v1ClassSummary(data: ClassSummaryItem[]): ClassSummaryItem[] {
  return data;
}
