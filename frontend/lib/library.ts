/**
 * The course template library (`/library`, behind `course_copy`): types and
 * small helpers shared by the library pages, the publish dialog on a course
 * and the import dialog.
 */

export type LibraryVisibility = "school" | "organisation";
export type LibraryScope = "all" | "school" | "organisation" | "mine";

export interface LibraryCounts {
  modules: number;
  moduleItems: number;
  pages: number;
  activities: number;
  quizzes: number;
  rubrics: number;
  questionBanks: number;
  discussionTopics: number;
  files: number;
  externalTools: number;
}

export interface LibrarySelection {
  moduleIds?: string[];
  activityIds?: string[];
  pageIds?: string[];
  rubricIds?: string[];
}

export interface LibraryItem {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  gradeLevel: string | null;
  tags: string[];
  visibility: LibraryVisibility;
  latestVersion: number;
  published: boolean;
  unpublishedAt: string | null;
  schoolName: string | null;
  fromYourSchool: boolean;
  authorName: string | null;
  sourceCourseId: string | null;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
  latest?: {
    version: number;
    counts: LibraryCounts;
    fileCount: number;
    fileBytes: number;
    publishedAt: string;
  } | null;
}

export interface LibraryVersion {
  version: number;
  counts: LibraryCounts;
  fileCount: number;
  fileBytes: number;
  note: string | null;
  publishedAt: string;
}

export interface LibraryPreview {
  version: number;
  counts: LibraryCounts;
  selection: LibrarySelection | null;
  modules: {
    id: string;
    title: string;
    items: { type: string; title: string; indent: number; url: string | null }[];
  }[];
  pages: { id: string; title: string; body: string }[];
  activities: {
    id: string;
    kind: string;
    title: string;
    points: number;
    instructions: string | null;
    questionCount: number;
    questions: { prompt: string; kind: string; points: number }[];
  }[];
  rubrics: { id: string; title: string; criteria: { title: string; points: number }[] }[];
  files: { name: string; contentType: string; sizeBytes: number }[];
}

export type LibraryItemDetail = LibraryItem & {
  versions: LibraryVersion[];
  preview: LibraryPreview;
};

export type ImportStatus = "queued" | "copying" | "done" | "failed";

export interface LibraryImport {
  id: string;
  itemId: string;
  itemTitle: string;
  version: number;
  mode: "append" | "new_course";
  targetCourseId: string | null;
  status: ImportStatus;
  filesTotal: number;
  filesDone: number;
  result: Record<string, number> | null;
  notes: string[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Bytes as "1.2 MB" (binary units, one decimal past KB). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${v} B` : `${v.toFixed(1).replace(/\.0$/, "")} ${units[i]}`;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** "3 modules · 2 quizzes · 4 pages · 1 file", leaving out zeros. */
export function countsSummary(c: LibraryCounts | null | undefined): string {
  if (!c) return "";
  const parts = [
    c.modules ? plural(c.modules, "module") : null,
    c.activities - c.quizzes > 0
      ? plural(c.activities - c.quizzes, "assignment")
      : null,
    c.quizzes ? plural(c.quizzes, "quiz", "quizzes") : null,
    c.pages ? plural(c.pages, "page") : null,
    c.rubrics ? plural(c.rubrics, "rubric") : null,
    c.files ? plural(c.files, "file") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Empty";
}

/** Whole-number percent of files copied; a finished import is 100. */
export function importPercent(i: Pick<LibraryImport, "status" | "filesDone" | "filesTotal">): number {
  if (i.status === "done") return 100;
  if (i.filesTotal <= 0) return i.status === "queued" ? 0 : 50;
  return Math.min(99, Math.round((i.filesDone / i.filesTotal) * 100));
}

/** What to tell the person about an import in progress. */
export function importLabel(i: Pick<LibraryImport, "status" | "filesDone" | "filesTotal">): string {
  switch (i.status) {
    case "queued":
      return "Waiting to start…";
    case "copying":
      return i.filesTotal > 0
        ? `Copying files (${i.filesDone} of ${i.filesTotal})…`
        : "Copying content…";
    case "done":
      return "Imported";
    default:
      return "Import failed";
  }
}

export const isFinished = (s: ImportStatus) => s === "done" || s === "failed";

/** Comma- or newline-separated tags, trimmed, lower-cased, de-duplicated. */
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,\n]/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

/** The query string for a browse request; empty filters are left out. */
export function browseQuery(f: {
  q?: string;
  subject?: string;
  gradeLevel?: string;
  tag?: string;
  scope?: LibraryScope;
  sourceCourseId?: string;
}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    const value = typeof v === "string" ? v.trim() : "";
    if (value && !(k === "scope" && value === "all")) params.set(k, value);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** A selection with nothing chosen means the whole course. */
export function isWholeCourse(sel: LibrarySelection | null | undefined): boolean {
  return (
    !sel ||
    [sel.moduleIds, sel.activityIds, sel.pageIds, sel.rubricIds].every(
      (l) => !l || l.length === 0,
    )
  );
}
