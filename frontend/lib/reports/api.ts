import { api, ApiError, buildUrl } from "../api";

export type ReportType = "term" | "year_end";

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

export interface ClassReportFile {
  id: string;
  student_group_id: string;
  term_id: string;
  report_type: string;
  file_type: string;
  file_path: string;
  file_size: number;
  generated_by: string | null;
  generated_at: string;
}

export function getClassSummary(
  studentGroupId: string,
  termId: string,
  reportType: ReportType,
) {
  const q = new URLSearchParams({ studentGroupId, termId, reportType });
  return api<ClassSummary>(`/reports/class-summary?${q.toString()}`);
}

export function getClassSummaryFiles(
  studentGroupId: string,
  termId: string,
  reportType: ReportType,
) {
  const q = new URLSearchParams({ studentGroupId, termId, reportType });
  return api<ClassReportFile[]>(`/reports/class-summary/files?${q.toString()}`);
}

export async function uploadClassSummaryFile(
  studentGroupId: string,
  termId: string,
  reportType: ReportType,
  blob: Blob,
  fileType: string,
  filename: string,
): Promise<ClassReportFile> {

  const access = await import("../auth").then((m) => m.getAccessToken());
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("studentGroupId", studentGroupId);
  form.append("termId", termId);
  form.append("reportType", reportType);
  form.append("fileType", fileType);

  const res = await fetch(buildUrl("/reports/class-summary/upload"), {
    method: "POST",
    headers: {
      Authorization: access ? `Bearer ${access}` : "",
      "X-API-Version": "1",
    },
    credentials: "include",
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, err.message || res.statusText, err);
  }

  return res.json();
}

export async function downloadClassSummaryFile(
  studentGroupId: string,
  termId: string,
  reportType: ReportType,
  fileType: string,
): Promise<Blob> {
  const { getAccessToken } = await import("../auth");
  const access = getAccessToken();
  const q = new URLSearchParams({ studentGroupId, termId, reportType, fileType });
  const res = await fetch(`${buildUrl("/reports/class-summary/download")}?${q.toString()}`, {
    headers: {
      Authorization: access ? `Bearer ${access}` : "",
      "X-API-Version": "1",
    },
    credentials: "include",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, err.message || res.statusText, err);
  }

  return res.blob();
}