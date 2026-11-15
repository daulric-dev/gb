import { api } from "@/lib/api";

/**
 * Data downloads: subject access / data portability exports (backend
 * src/data-export). Asking for one and downloading it both need "Confirm
 * it's you" (step-up); the dialog appears on its own.
 */

export type DataExportStatus = "pending" | "running" | "ready" | "failed" | "expired";
export type DataExportKind = "self" | "student" | "child";

/** GET /data-exports (ExportView). */
export interface DataExport {
  id: string;
  kind: DataExportKind;
  status: DataExportStatus | string;
  studentId: string | null;
  studentName: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  downloadedAt: string | null;
  byteSize: number | null;
  categories: Record<string, number>;
  filesIncluded: number;
  filesSkipped: number;
  /** Staff exports: pastoral notes withheld under an exemption. */
  withheldNotes?: number;
  /** Staff exports: the exporter could see every pastoral note. */
  pastoralComplete?: boolean;
  error: string | null;
}

export interface DataExportDownload {
  url: string;
  filename: string;
  urlExpiresAt: string;
}

/** Whose data: your own account, a student (staff), or a linked child (parent). */
export type DataExportTarget =
  | { kind: "self" }
  | { kind: "student"; studentId: string }
  | { kind: "child"; studentId: string };

export function requestPath(target: DataExportTarget): string {
  switch (target.kind) {
    case "self":
      return "/data-exports/me";
    case "student":
      return `/data-exports/students/${encodeURIComponent(target.studentId)}`;
    case "child":
      return `/data-exports/children/${encodeURIComponent(target.studentId)}`;
  }
}

export function listPath(target: DataExportTarget): string {
  return target.kind === "self"
    ? "/data-exports"
    : `/data-exports?${new URLSearchParams({ studentId: target.studentId }).toString()}`;
}

/**
 * The list answers every export the caller asked for; keep the ones about
 * this target (a parent's own and their child's exports share one list).
 */
export function exportsFor(rows: DataExport[], target: DataExportTarget): DataExport[] {
  return rows.filter(
    (e) => e.kind === target.kind && (target.kind === "self" || e.studentId === target.studentId),
  );
}

export async function listExports(target: DataExportTarget): Promise<DataExport[]> {
  const rows = await api<DataExport[]>(listPath(target));
  return exportsFor(Array.isArray(rows) ? rows : [], target);
}

export const requestExport = (target: DataExportTarget) =>
  api<DataExport>(requestPath(target), { method: "POST", stepUp: true });

export const downloadExport = (id: string) =>
  api<DataExportDownload>(`/data-exports/${encodeURIComponent(id)}/download`, {
    method: "POST",
    stepUp: true,
  });

export const deleteExport = (id: string) =>
  api(`/data-exports/${encodeURIComponent(id)}`, { method: "DELETE" });

// ---- pure helpers --------------------------------------------------------

export function isActiveExport(e: Pick<DataExport, "status">): boolean {
  return e.status === "pending" || e.status === "running";
}

/** Ready and not past its expiry: the ZIP can be downloaded. */
export function isDownloadable(
  e: Pick<DataExport, "status" | "expiresAt">,
  now: Date = new Date(),
): boolean {
  if (e.status !== "ready") return false;
  if (!e.expiresAt) return false;
  return new Date(e.expiresAt).getTime() > now.getTime();
}

/** What the card shows for an export's state, in one line. */
export type ExportPhase = "preparing" | "ready" | "failed" | "expired";

export function exportPhase(
  e: Pick<DataExport, "status" | "expiresAt">,
  now: Date = new Date(),
): ExportPhase {
  if (isActiveExport(e)) return "preparing";
  if (e.status === "ready") return isDownloadable(e, now) ? "ready" : "expired";
  if (e.status === "failed") return "failed";
  return "expired";
}

/** Whether a new export can be asked for: none is being prepared already. */
export function canRequestNew(rows: Pick<DataExport, "status">[]): boolean {
  return !rows.some(isActiveExport);
}

/** Keep polling while any export is being prepared. */
export function shouldPoll(rows: Pick<DataExport, "status">[]): boolean {
  return rows.some(isActiveExport);
}

/**
 * Delay before poll number `attempt` (0-based): quick at first (small
 * exports finish in seconds), then backing off to once every 30 seconds.
 */
export function pollDelayMs(attempt: number): number {
  const steps = [3000, 5000, 10000, 15000, 20000];
  return attempt < steps.length ? steps[Math.max(0, attempt)] : 30000;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The status line under an export. */
export function exportStatusText(
  e: Pick<DataExport, "status" | "expiresAt" | "error">,
  now: Date = new Date(),
  when: (iso: string) => string = formatWhen,
): string {
  switch (exportPhase(e, now)) {
    case "preparing":
      return e.status === "running"
        ? "Being prepared. We'll email you when it's ready."
        : "Waiting to be prepared. We'll email you when it's ready.";
    case "ready":
      return `Ready to download until ${when(e.expiresAt!)}`;
    case "failed":
      return e.error ? `It could not be prepared: ${e.error}` : "It could not be prepared.";
    case "expired":
      return "Expired. Ask for a new download if you still need it.";
  }
}

export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** Category ids as the backend collectors name them (src/data-export/collectors). */
export const CATEGORY_LABELS: Record<string, string> = {
  profile: "Profile",
  "sign-in-identities": "Sign-in identities",
  sessions: "Sign-in sessions",
  devices: "Devices",
  "account-security": "Account security",
  memberships: "Schools, roles and classes",
  coursework: "Coursework and grades",
  mastery: "Learning outcomes (mastery)",
  attendance: "Attendance",
  reports: "Report cards",
  files: "Files",
  chat: "Chat",
  discussions: "Course discussions and announcements",
  notifications: "Notifications",
  "ai-requests": "AI requests",
  integrations: "Connected tools and rostering",
  "audit-log": "Audit log",
  "pastoral-notes": "Behaviour and pastoral notes",
  "staff-records": "Staff records about the student",
};

export function categoryLabel(id: string): string {
  return CATEGORY_LABELS[id] ?? id.replace(/[-_]/g, " ");
}

/** "Coursework and grades (12), Attendance (40)" for a finished export. */
export function categorySummary(categories: Record<string, number> | null | undefined): string[] {
  return Object.entries(categories ?? {})
    .filter(([, n]) => typeof n === "number" && n > 0)
    .map(([id, n]) => `${categoryLabel(id)} (${n})`);
}

/**
 * Staff exports: what the person answering a subject access request must
 * know before sending it on. Empty for other exports.
 */
export function staffExportWarnings(
  e: Pick<DataExport, "kind" | "status" | "withheldNotes" | "pastoralComplete" | "filesSkipped">,
): string[] {
  const out: string[] = [];
  if (e.kind === "student" && e.status === "ready") {
    const withheld = e.withheldNotes ?? 0;
    if (withheld > 0) {
      out.push(
        `${withheld} pastoral ${withheld === 1 ? "note was" : "notes were"} withheld from this export (marked "Withhold from data requests"). Record the exemption with your response.`,
      );
    }
    if (e.pastoralComplete === false) {
      out.push(
        "You can't see every pastoral note about this student, so some may be missing. Ask a colleague with the safeguarding permission to check before you send it.",
      );
    }
  }
  if (e.status === "ready" && e.filesSkipped > 0) {
    out.push(
      `${e.filesSkipped} ${e.filesSkipped === 1 ? "file was" : "files were"} too large to include; README.txt in the download lists them.`,
    );
  }
  return out;
}

/** What each kind of export holds, for the card's description. */
export function includedText(kind: DataExportKind): string {
  switch (kind) {
    case "self":
      return "Everything GradeBook holds about your account: profile, sign-in history and devices, schools and roles, coursework and grades, attendance, report cards, files you uploaded, chat messages you sent, discussions, notifications, AI requests and your audit-log entries. Messages other people sent are theirs and are not included.";
    case "student":
      return "The student's record: profile, enrolments, coursework and grades, attendance, report cards and learning outcomes, plus pastoral notes and staff records you are allowed to see. It also includes the student's own sent chat messages, uploaded files, sign-in sessions and devices.";
    case "child":
      return "What the school shares with you about your child: their profile, classes, and the grades, work, attendance, report cards and learning outcomes the school shows parents.";
  }
}
