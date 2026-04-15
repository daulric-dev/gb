import { api, ApiError } from "./api";

export type ReportStatus = "draft" | "published" | "sent_to_ministry";
export type ReportType = "term" | "year_end";

export interface ReportStudentBrief {
  id: string;
  first_name: string;
  last_name: string;
  registration_number?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
}

export interface ReportBookListItem {
  id: string;
  student_id: string;
  academic_year_id?: string | null;
  term_id: string;
  student_group_id: string;
  report_type: ReportType | null;
  status: ReportStatus | null;
  overall_average: number | null;
  position: number | null;
  total_students: number | null;
  class_teacher_remark?: string | null;
  conduct?: string | null;
  attendance_percentage?: number | null;
  student?: ReportStudentBrief | null;
}

export interface ReportSubjectEmbed {
  id: string;
  name: string;
  code: string;
  is_graded: boolean;
  sort_order: number;
}

export interface ReportEntryRow {
  id: string;
  report_book_id: string;
  subject_id: string;
  coursework_average: number | null;
  exam_average: number | null;
  term_composite: number | null;
  year_grade: number | null;
  letter_grade: string | null;
  teacher_remark: string | null;
  sort_order: number;
  subject: ReportSubjectEmbed | null;
}

export interface ReportPdfRow {
  id: string;
  report_book_id: string;
  file_path: string;
  file_size: number;
  generated_by: string;
  generated_at: string;
}

export type ReportDetail = ReportBookListItem & {
  student: ReportStudentBrief | null;
  entries: ReportEntryRow[];
  pdfs: ReportPdfRow[];
};

export function defaultPdfStoragePath(r: {
  id: string;
  student_group_id: string;
  term_id: string;
}): string {
  return `${r.student_group_id}/${r.term_id}/${r.id}.pdf`;
}

export function defaultPdfFileSizeBytes(r: { pdfs?: ReportPdfRow[] }): number {
  const last = r.pdfs?.[0];
  if (last != null && last.file_size >= 1) {
    return last.file_size;
  }
  return 245760;
}

export function listReportsForClassTerm(
  studentGroupId: string,
  termId: string,
  reportType?: ReportType,
) {
  const q = new URLSearchParams({ studentGroupId, termId });
  if (reportType) q.set("reportType", reportType);
  return api<ReportBookListItem[]>(`/reports?${q.toString()}`);
}

export function getReport(reportId: string) {
  return api<ReportDetail>(`/reports/${reportId}`);
}

export function getStudentReport(
  studentId: string,
  termId: string,
  reportType: ReportType,
) {
  const q = new URLSearchParams({ studentId, termId, reportType });
  return api<ReportDetail | null>(`/reports/student?${q.toString()}`);
}

export function generateReports(body: {
  termId: string;
  studentGroupId: string;
  reportType: ReportType;
  studentId?: string;
}) {
  return api<{ generated: number; message: string }>("/reports/generate", {
    method: "POST",
    body,
  });
}

export function updateReport(
  reportId: string,
  body: {
    classTeacherRemark?: string;
    conduct?: string;
    attendancePercentage?: number;
  },
) {
  return api<ReportBookListItem>(`/reports/${reportId}`, {
    method: "PATCH",
    body,
  });
}

export function updateReportEntry(
  entryId: string,
  body: { teacherRemark?: string; letterGrade?: string },
) {
  return api<ReportEntryRow>(`/report-entries/${entryId}`, {
    method: "PATCH",
    body,
  });
}

export function regenerateReport(reportId: string) {
  return api<ReportDetail>(`/reports/${reportId}/regenerate`, {
    method: "PATCH",
  });
}

export function publishReport(reportId: string) {
  return api<ReportBookListItem>(`/reports/${reportId}/publish`, {
    method: "PATCH",
  });
}

export function sendReportToMinistry(reportId: string) {
  return api<ReportBookListItem>(`/reports/${reportId}/send-to-ministry`, {
    method: "PATCH",
  });
}

export function saveReportPdf(
  reportId: string,
  body: { filePath: string; fileSize: number },
) {
  return api<ReportPdfRow>(`/reports/${reportId}/pdf`, {
    method: "POST",
    body,
  });
}

export async function uploadReportPdf(
  reportId: string,
  blob: Blob,
  objectPath: string,
): Promise<ReportPdfRow> {
  const { access } = await import("./auth").then((m) => m.getTokens());
  const form = new FormData();
  form.append("file", blob, "report.pdf");
  form.append("objectPath", objectPath);

  const base = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/v1`;
  const res = await fetch(`${base}/reports/${reportId}/pdf/upload`, {
    method: "POST",
    headers: {
      Authorization: access ? `Bearer ${access}` : "",
      "X-API-Version": "1",
    },
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, err.message || res.statusText, err);
  }

  return res.json();
}

export async function downloadReportPdf(reportId: string, pdfId: string): Promise<Blob> {
  const { getTokens } = await import("./auth");
  const { access } = getTokens();
  const base = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/v1`;
  const res = await fetch(`${base}/reports/${reportId}/pdf/${pdfId}/download`, {
    headers: {
      Authorization: access ? `Bearer ${access}` : "",
      "X-API-Version": "1",
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, err.message || res.statusText, err);
  }

  return res.blob();
}

export function getPdfHistory(reportId: string) {
  return api<ReportPdfRow[]>(`/reports/${reportId}/pdfs`);
}

export function getLatestPdf(reportId: string) {
  return api<ReportPdfRow | null>(`/reports/${reportId}/pdf/latest`);
}

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
  const { access } = await import("./auth").then((m) => m.getTokens());
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("studentGroupId", studentGroupId);
  form.append("termId", termId);
  form.append("reportType", reportType);
  form.append("fileType", fileType);

  const base = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/v1`;
  const res = await fetch(`${base}/reports/class-summary/upload`, {
    method: "POST",
    headers: {
      Authorization: access ? `Bearer ${access}` : "",
      "X-API-Version": "1",
    },
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
  const { getTokens } = await import("./auth");
  const { access } = getTokens();
  const q = new URLSearchParams({ studentGroupId, termId, reportType, fileType });
  const base = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/v1`;
  const res = await fetch(`${base}/reports/class-summary/download?${q.toString()}`, {
    headers: {
      Authorization: access ? `Bearer ${access}` : "",
      "X-API-Version": "1",
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, err.message || res.statusText, err);
  }

  return res.blob();
}