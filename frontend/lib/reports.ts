import { api } from "./api";

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

export function listReportsForClassTerm(studentGroupId: string, termId: string) {
  const q = new URLSearchParams({ studentGroupId, termId });
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

export function getPdfHistory(reportId: string) {
  return api<ReportPdfRow[]>(`/reports/${reportId}/pdfs`);
}

export function getLatestPdf(reportId: string) {
  return api<ReportPdfRow | null>(`/reports/${reportId}/pdf/latest`);
}