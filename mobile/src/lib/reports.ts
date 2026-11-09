/**
 * The student's published term reports. Mirrors the web
 * `frontend/lib/report-cards.ts` wire types for `/portal/me/reports`.
 */

export type ReportStatus = "pending" | "ready" | "failed";

export interface PublishedReport {
  /** The report document id: what the file route takes. */
  id: string;
  termId: string;
  termName: string;
  yearName: string | null;
  startDate: string | null;
  endDate: string | null;
  publishedAt: string;
  status: ReportStatus;
}

/** "Autumn · 2026-27", or just the term name. */
export function reportTitle(r: { termName: string; yearName: string | null }): string {
  return r.yearName ? `${r.termName} · ${r.yearName}` : r.termName;
}

/** The authenticated route that streams the PDF (for downloadAndOpen). */
export function reportFilePath(id: string): string {
  return `/portal/me/reports/${encodeURIComponent(id)}/file`;
}

export const TRANSCRIPT_PDF_PATH = "/portal/me/transcript.pdf";

/** A parent's view of a linked child's reports (`/parent/children/:id/...`). */
export function parentReportsPath(studentId: string): string {
  return `/parent/children/${encodeURIComponent(studentId)}/reports`;
}

export function parentReportFilePath(studentId: string, id: string): string {
  return `${parentReportsPath(studentId)}/${encodeURIComponent(id)}/file`;
}

export function parentTranscriptPdfPath(studentId: string): string {
  return `/parent/children/${encodeURIComponent(studentId)}/transcript.pdf`;
}
