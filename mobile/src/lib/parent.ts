/**
 * Parent portal: API shapes (backend `src/parent-portal`) and pure helpers
 * for the `(parent)` tab group. Mirrors the web `lib/parent.ts`.
 */

export type Relationship = "mother" | "father" | "guardian";

export interface ParentVisibility {
  grades: boolean;
  work: boolean;
  attendance: boolean;
  announcements: boolean;
  /** Published report cards and the transcript. */
  reports: boolean;
  /** Mastery of learning outcomes (`showMastery` and `mastery`); missing from older servers. */
  mastery?: boolean;
  notifications: boolean;
}

/** GET /parent/children */
export interface ParentChild {
  id: string;
  firstName: string | null;
  lastName: string | null;
  relationship: Relationship | null;
  relationshipLabel: string | null;
  school: { id: string; name: string | null; logoUrl: string | null };
  visibility: ParentVisibility;
}

export interface ParentCourse {
  id: string;
  name: string;
  code: string | null;
  status: "published" | "archived" | string;
  teachers: { firstName: string | null; lastName: string | null }[];
  grade: { percent: number | null; letter: string | null } | null;
}

/** GET /parent/children/:id */
export interface ParentOverview {
  child: { id: string; firstName: string | null; lastName: string | null };
  school: { id: string; name: string | null; logoUrl: string | null } | null;
  visibility: ParentVisibility;
  courses: ParentCourse[];
  upcomingCount: number | null;
  missingCount: number | null;
}

export type ParentWorkState = "upcoming" | "missing" | "submitted" | "graded" | "excused";

export interface ParentWorkItem {
  id: string;
  courseId: string;
  courseName: string | null;
  kind: string;
  title: string;
  points: number;
  dueAt: string | null;
  hasExtension: boolean;
  state: ParentWorkState;
  submittedAt: string | null;
  score: number | null;
}

/** GET /parent/children/:id/work */
export interface ParentWork {
  upcoming: ParentWorkItem[];
  missing: ParentWorkItem[];
  done: ParentWorkItem[];
}

/** GET /parent/children/:id/courses/:courseId/grades */
export interface ParentCourseGrades {
  grade: {
    percent: number | null;
    letter: string | null;
    groups: {
      groupId: string | null;
      name: string;
      weight: number | null;
      earned: number;
      possible: number;
      percent: number | null;
    }[];
  };
  activities: {
    id: string;
    title: string;
    kind: string;
    points: number;
    dueAt: string | null;
    groupName: string | null;
    dropped: boolean;
    status: "graded" | "submitted" | "excused" | "not_submitted";
    score: number | null;
  }[];
}

export interface AttendanceTally {
  present: number;
  late: number;
  absent: number;
  excused: number;
  rate: number | null;
}

/** GET /parent/children/:id/attendance */
export interface ParentAttendance {
  summary: AttendanceTally;
  courses: {
    courseId: string;
    courseName: string;
    summary: AttendanceTally;
    records: {
      sessionId: string;
      title: string | null;
      openedAt: string;
      status: "present" | "late" | "absent" | "excused" | null;
      checkedInAt: string | null;
    }[];
  }[];
}

/**
 * GET /parent/children/:id/announcements: the child's school's posts for
 * everyone (`scope: "school"`) and their courses' posts (`scope: "course"`),
 * newest first. Older servers send course posts without `scope`.
 */
export interface ParentAnnouncement {
  id: string;
  scope?: "school" | "course";
  courseId: string | null;
  courseName: string | null;
  schoolName?: string | null;
  title: string;
  body: string | null;
  createdAt: string | null;
  author: { firstName: string | null; lastName: string | null } | null;
}

export const NOTICE_KINDS = [
  "missing_work",
  "absence",
  "new_grade",
  "announcement",
  "attendance_alert",
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const NOTICE_LABELS: Record<NoticeKind, string> = {
  missing_work: "Missing work",
  absence: "Absences",
  new_grade: "New grades",
  announcement: "Announcements (school and courses)",
  attendance_alert: "Attendance alerts",
};

/** GET/PUT /parent/notifications/preferences */
export interface ParentNotificationPrefs {
  emailEnabled: boolean;
  pushEnabled: boolean;
  kinds: NoticeKind[];
}

/** Staff: GET /students/:id/parents */
export interface StudentParents {
  links: {
    id: string;
    parent: { id: string; firstName: string | null; lastName: string | null; email: string | null };
    relationship: Relationship | null;
    relationshipLabel: string | null;
    createdAt: string;
  }[];
  invites: {
    id: string;
    kind: "email" | "code";
    email: string | null;
    relationship: Relationship | null;
    relationshipLabel: string | null;
    expiresAt: string;
    createdAt: string;
  }[];
}

/** Staff: GET/PATCH /schools/current/parent-settings */
export interface ParentSettings {
  showGrades: boolean;
  showWork: boolean;
  showAttendance: boolean;
  showAnnouncements: boolean;
  showReports: boolean;
  /** Mastery of learning outcomes; off by default. Missing from older servers. */
  showMastery?: boolean;
  maxStudentAge: number | null;
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Where an announcement came from, for the line under its title. */
export function announcementSource(a: ParentAnnouncement): string {
  if (a.scope === "school" || (!a.scope && !a.courseId)) {
    return a.schoolName ? `${a.schoolName} (whole school)` : "Whole school";
  }
  return a.courseName ?? "Course";
}

export function personName(
  p: { firstName: string | null; lastName: string | null } | null | undefined,
  fallback = "",
): string {
  if (!p) return fallback;
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || fallback;
}

/** "Mother", "Grandmother" (the label wins), or null. */
export function relationshipText(
  relationship: Relationship | null | undefined,
  label?: string | null,
): string | null {
  const l = label?.trim();
  if (l) return l;
  if (!relationship) return null;
  return relationship[0].toUpperCase() + relationship.slice(1);
}

const CODE_CHARS = /[^A-Z0-9]/g;

/** A typed link code as XXXXX-XXXXX (upper case, separators tidied). */
export function formatLinkCode(raw: string): string {
  const clean = raw.toUpperCase().replace(CODE_CHARS, "").slice(0, 10);
  return clean.length > 5 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : clean;
}

export function isCompleteLinkCode(raw: string): boolean {
  return raw.toUpperCase().replace(CODE_CHARS, "").length === 10;
}

export const WORK_STATE_LABELS: Record<ParentWorkState, string> = {
  upcoming: "Upcoming",
  missing: "Missing",
  submitted: "Handed in",
  graded: "Marked",
  excused: "Excused",
};

/** "92%" or "—" for no counted sessions. */
export function attendanceRate(t: AttendanceTally | null | undefined): string {
  if (!t || t.rate === null || t.rate === undefined) return "—";
  return `${Math.round(t.rate * 10) / 10}%`;
}

/** "B+ (88%)", "88%", "B+" or "No grade yet". */
export function gradeText(grade: { percent: number | null; letter: string | null } | null): string {
  if (!grade || (grade.percent === null && !grade.letter)) return "No grade yet";
  const pct = grade.percent === null ? null : `${Math.round(grade.percent * 10) / 10}%`;
  if (grade.letter && pct) return `${grade.letter} (${pct})`;
  return grade.letter ?? pct!;
}

/** Toggle one notice kind, keeping the catalog order. */
export function toggleNoticeKind(kinds: NoticeKind[], kind: NoticeKind, on: boolean): NoticeKind[] {
  const set = new Set(kinds);
  if (on) set.add(kind);
  else set.delete(kind);
  return NOTICE_KINDS.filter((k) => set.has(k));
}
