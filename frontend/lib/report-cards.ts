/**
 * Report cards: API shapes and the pure helpers the comment table, the
 * release dashboard and the student's reports page share. The backend lives
 * in `backend/src/report-card`; every route is behind the `report_cards`
 * feature.
 */

export type CommentStatus = "draft" | "ready";
export type DocumentStatus = "pending" | "ready" | "failed";

export interface ReportTermRef {
  id: string;
  name: string;
  yearName: string | null;
}

export interface ReportTerm extends ReportTermRef {
  startDate: string | null;
  endDate: string | null;
}

/** GET /courses/:courseId/report-comments */
export interface CourseReportComments {
  course: { id: string; name: string; code: string | null };
  terms: ReportTermRef[];
  term: ReportTerm | null;
  deadline: string | null;
  publishedAt: string | null;
  canEdit: boolean;
  students: {
    studentId: string;
    firstName: string | null;
    lastName: string | null;
    percent: number | null;
    letter: string | null;
    comment: string;
    status: CommentStatus | null;
    updatedAt: string | null;
  }[];
}

/** GET /report-cards/terms */
export interface ReleaseTerm extends ReportTerm {
  commentDeadline: string | null;
  publishedAt: string | null;
}

export interface CourseCompletion {
  courseId: string;
  name: string;
  code: string | null;
  teachers: string[];
  yearLong: boolean;
  students: number;
  ready: number;
  draft: number;
  missing: number;
}

/** GET /report-cards/terms/:termId */
export interface ReleaseOverview {
  term: ReportTerm;
  commentDeadline: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  students: number;
  courses: CourseCompletion[];
  totals: { comments: number; ready: number; draft: number; missing: number };
  documents: Record<DocumentStatus, number>;
  generationMode: "queue" | "inline";
  queued?: number;
}

/** GET /report-cards/terms/:termId/students */
export interface ReleaseStudent {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  courses: number;
  headComment: string;
  document: {
    id: string;
    status: DocumentStatus;
    error: string | null;
    generatedAt: string | null;
  } | null;
}

/** GET /portal/me/reports */
export interface PublishedReport {
  id: string;
  termId: string;
  termName: string;
  yearName: string | null;
  startDate: string | null;
  endDate: string | null;
  publishedAt: string;
  status: DocumentStatus;
}

/** GET /portal/me/transcript */
export interface Transcript {
  student: { name: string };
  generatedAt: string;
  terms: {
    yearName: string | null;
    termName: string;
    startDate: string | null;
    endDate: string | null;
    courses: { name: string; code: string | null; percent: number | null; letter: string | null }[];
  }[];
}

/** Longest comment the API accepts. */
export const REPORT_COMMENT_MAX = 2000;

/** "Autumn · 2026-27", or just the name. */
export function termLabel(term: { name: string; yearName: string | null }): string {
  return term.yearName ? `${term.name} · ${term.yearName}` : term.name;
}

/** Share of comments marked ready, as a whole percentage (0 when nobody is enrolled). */
export function completionPercent(c: { ready: number; students: number }): number {
  if (c.students <= 0) return 0;
  return Math.round((c.ready / c.students) * 100);
}

export type DeadlineState = "none" | "open" | "soon" | "passed";

/** Whether the comment deadline is unset, comfortably ahead, within 3 days, or gone. */
export function deadlineState(deadline: string | null, now = new Date()): DeadlineState {
  if (!deadline) return "none";
  const at = new Date(deadline).getTime();
  if (Number.isNaN(at)) return "none";
  const diff = at - now.getTime();
  if (diff < 0) return "passed";
  if (diff <= 3 * 24 * 60 * 60 * 1000) return "soon";
  return "open";
}

/** A comment row as the table edits it. */
export interface CommentDraft {
  studentId: string;
  body: string;
  status: CommentStatus;
}

/** The table's starting drafts: an untouched student is an empty draft. */
export function initialDrafts(students: CourseReportComments["students"]): Record<string, CommentDraft> {
  const out: Record<string, CommentDraft> = {};
  for (const s of students) {
    out[s.studentId] = { studentId: s.studentId, body: s.comment, status: s.status ?? "draft" };
  }
  return out;
}

/**
 * Only the rows that differ from what was loaded, so "Save" sends what the
 * teacher changed. Whitespace-only differences at the ends do not count
 * (the API trims), and an untouched empty row is never sent.
 */
export function changedComments(
  original: CourseReportComments["students"],
  drafts: Record<string, CommentDraft>,
): CommentDraft[] {
  const out: CommentDraft[] = [];
  for (const s of original) {
    const d = drafts[s.studentId];
    if (!d) continue;
    const before = { body: s.comment.trim(), status: s.status ?? "draft" };
    const after = { body: d.body.trim(), status: d.status };
    if (before.body === after.body && before.status === after.status) continue;
    if (!s.status && !after.body && after.status === "draft") continue;
    out.push({ studentId: d.studentId, body: d.body, status: d.status });
  }
  return out;
}

/** Problems that would make the API refuse a save, per student id. */
export function draftErrors(drafts: CommentDraft[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of drafts) {
    if (d.body.length > REPORT_COMMENT_MAX) out[d.studentId] = `At most ${REPORT_COMMENT_MAX} characters`;
    else if (d.status === "ready" && !d.body.trim()) out[d.studentId] = "Write a comment before marking it ready";
  }
  return out;
}

/** Mark every written comment ready (the table's bulk action); empty rows stay drafts. */
export function markAllReady(drafts: Record<string, CommentDraft>): Record<string, CommentDraft> {
  const out: Record<string, CommentDraft> = {};
  for (const [id, d] of Object.entries(drafts)) {
    out[id] = d.body.trim() ? { ...d, status: "ready" } : d;
  }
  return out;
}

/** "12 ready · 2 generating · 1 failed" for the dashboard. */
export function documentSummary(docs: Record<DocumentStatus, number>): string {
  const parts: string[] = [];
  if (docs.ready) parts.push(`${docs.ready} ready`);
  if (docs.pending) parts.push(`${docs.pending} generating`);
  if (docs.failed) parts.push(`${docs.failed} failed`);
  return parts.join(" · ") || "Not generated yet";
}

/** What the publish confirmation should warn about, if anything. */
export function publishWarnings(o: Pick<ReleaseOverview, "totals" | "students">): string[] {
  const out: string[] = [];
  if (o.students === 0) out.push("No students are enrolled in this term's courses.");
  if (o.totals.missing > 0) {
    out.push(`${o.totals.missing} comment${o.totals.missing === 1 ? " is" : "s are"} missing.`);
  }
  if (o.totals.draft > 0) {
    out.push(`${o.totals.draft} comment${o.totals.draft === 1 ? " is" : "s are"} still a draft.`);
  }
  return out;
}

/** "Lovelace-Ada-Autumn-report.pdf"-style fallback name when the server sends none. */
export function reportFallbackName(student: { firstName: string | null; lastName: string | null }, termName: string): string {
  const raw = `${student.lastName ?? ""} ${student.firstName ?? ""} ${termName} report`;
  const cleaned = raw.replace(/[^A-Za-z0-9._ -]+/g, "").trim().replace(/\s+/g, "-");
  return `${cleaned || "report"}.pdf`;
}
