/**
 * Wire shapes for the course API. The backend returns exactly these
 * (camelCase); see LMS_REVAMP_PLAN.md for the endpoints that serve them.
 */

export type CourseStatus = "draft" | "published" | "archived";
export type CourseRole = "admin" | "teacher" | "ta";

export interface Course {
  id: string;
  schoolId: string;
  academicYearId: string | null;
  termId: string | null;
  name: string;
  code: string | null;
  description: string | null;
  status: CourseStatus;
  joinCode: string | null;
  gradeScaleId: string | null;
  /** A school template: copied into new courses, never takes students. */
  isTemplate: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** The caller's role in this course. */
  role: CourseRole;
  /** Active students. */
  studentCount: number;
}

/** A school template, as `GET /courses/templates` lists it. */
export interface CourseTemplate
  extends Omit<Course, "role" | "studentCount"> {
  moduleCount: number;
  activityCount: number;
  pageCount: number;
}

/**
 * How due dates move into a copy: at most one of a day shift, the gap
 * between two start dates, or clearing them. None keeps every date.
 */
export interface CopyDates {
  shiftDays?: number;
  sourceStartDate?: string;
  targetStartDate?: string;
  clearDueDates?: boolean;
}

/** What a copy or import wrote. */
export interface CopyCounts {
  assignmentGroups: number;
  rubrics: number;
  activities: number;
  quizQuestions: number;
  pages: number;
  modules: number;
  moduleItems: number;
  discussionTopics: number;
}

/** `POST /courses/:id/copy` answers with the new course and its counts. */
export type CopiedCourse = Course & { copied: CopyCounts };

export interface CourseStaffMember {
  userProfileId: string;
  role: "teacher" | "ta";
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export interface CourseStudent {
  studentId: string;
  status: "active" | "dropped" | "completed";
  enrolledAt: string;
  firstName: string | null;
  lastName: string | null;
  hasAccount: boolean;
}

export interface CoursePeople {
  staff: CourseStaffMember[];
  students: CourseStudent[];
}

// ── content ────────────────────────────────────────────────────────────────

export type ModuleItemType =
  | "page"
  | "activity"
  | "file"
  | "link"
  | "header"
  | "discussion";

export interface ModuleItem {
  id: string;
  moduleId: string;
  position: number;
  itemType: ModuleItemType;
  /** Own title, else the page/activity/file/topic name it points at. */
  title: string;
  pageId: string | null;
  activityId: string | null;
  fileId: string | null;
  discussionTopicId: string | null;
  url: string | null;
  indent: number;
  isPublished: boolean;
  /** Present when itemType is "activity". */
  activity?: {
    kind: ActivityKind;
    points: number;
    dueAt: string | null;
    status: ActivityStatus;
  };
}

export interface CourseModule {
  id: string;
  courseId: string;
  title: string;
  position: number;
  isPublished: boolean;
  items: ModuleItem[];
}

export interface CoursePageSummary {
  id: string;
  courseId: string;
  title: string;
  isPublished: boolean;
  updatedAt: string;
}

export interface CoursePage extends CoursePageSummary {
  /** Markdown. */
  body: string;
  createdBy: string | null;
  createdAt: string;
}

// ── work and grading ───────────────────────────────────────────────────────

export type ActivityKind = "quiz" | "assignment" | "offline";
export type ActivityStatus = "draft" | "published" | "closed";
export type SubmissionStatus = "draft" | "submitted" | "graded";

export interface AssignmentGroup {
  id: string;
  courseId: string;
  name: string;
  /** Percent of the course total; null when the course is unweighted. */
  weight: number | null;
  position: number;
  /** Each student's N marks that hurt the group most are left out. */
  dropLowest: number;
  /** Then each student's N best marks are left out. */
  dropHighest: number;
}

export interface Activity {
  id: string;
  courseId: string;
  assignmentGroupId: string | null;
  kind: ActivityKind;
  title: string;
  instructions: string | null;
  points: number;
  dueAt: string | null;
  status: ActivityStatus;
  publishedAt: string | null;
  allowFile: boolean;
  allowText: boolean;
  /** 0 means unlimited. */
  maxAttempts: number;
  omitFromFinalGrade: boolean;
  /** The course rubric marking uses; quizzes never have one. */
  rubricId: string | null;
  createdAt: string;
}

export interface GroupScore {
  /** null for the implicit "Ungrouped" bucket. */
  groupId: string | null;
  name: string;
  weight: number | null;
  earned: number;
  possible: number;
  /** null when nothing in the group has been marked yet. */
  percent: number | null;
  /** Activity ids this group's drop rules left out. */
  dropped: string[];
}

export interface CourseGrade {
  /** 0-100, null when nothing counted has been marked. */
  percent: number | null;
  /** From the course grade scale, else the school default. */
  letter: string | null;
  groups: GroupScore[];
  /** Every activity id left out by a drop rule. */
  dropped: string[];
}

export interface GradebookCell {
  score: number | null;
  status: SubmissionStatus | null;
  excused: boolean;
  submittedAt: string | null;
  /** Left out of the total by its group's drop rule. */
  dropped: boolean;
}

export interface GradebookRow {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  status: CourseStudent["status"];
  /** Keyed by activity id; missing means no submission at all. */
  cells: Record<string, GradebookCell>;
  grade: CourseGrade;
}

export interface Gradebook {
  groups: AssignmentGroup[];
  /** Published and closed activities, in due-date order. */
  activities: Activity[];
  students: GradebookRow[];
}

// ── student portal ─────────────────────────────────────────────────────────

export interface PortalCourseCard {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: CourseStatus;
  termId: string | null;
  teachers: { firstName: string | null; lastName: string | null }[];
  grade: CourseGrade | null;
}

export interface PortalSubmissionState {
  status: SubmissionStatus;
  score: number | null;
  excused: boolean;
  attemptCount: number;
  submittedAt: string | null;
  feedback: string | null;
}

export interface PortalCourseActivity
  extends Omit<Activity, "omitFromFinalGrade" | "createdAt"> {
  /** null when the student has not started it. */
  submission: PortalSubmissionState | null;
}

export interface PortalCourseGrades {
  grade: CourseGrade;
  groups: AssignmentGroup[];
  activities: (PortalCourseActivity & {
    groupName: string | null;
    /** Left out of the total by its group's drop rule. */
    dropped: boolean;
  })[];
}

// ── rubrics ────────────────────────────────────────────────────────────────

export interface RubricRating {
  id: string;
  label: string;
  description: string | null;
  points: number;
}

export interface RubricCriterion {
  id: string;
  title: string;
  description: string | null;
  points: number;
  ratings: RubricRating[];
}

export interface Rubric {
  id: string;
  courseId: string;
  title: string;
  /** Sum of the criteria's points. */
  pointsPossible: number;
  criteria: RubricCriterion[];
  /** Used to mark someone: its criteria can no longer change. */
  assessed: boolean;
  updatedAt: string | null;
}

/** One criterion's mark for one student. */
export interface RubricAssessment {
  criterionId: string;
  ratingId: string | null;
  points: number;
  comment: string | null;
}

/** GET /activities/:id/rubric - the marking screen's view. */
export interface ActivityRubric {
  rubric: Rubric | null;
  /** Keyed by student id. */
  assessments: Record<string, RubricAssessment[]>;
}

// ── gradebook import ───────────────────────────────────────────────────────

export interface GradebookImportPlan {
  columns: {
    index: number;
    header: string;
    activityId: string | null;
    status: "activity" | "student" | "ignored" | "ambiguous";
  }[];
  rowCount: number;
  matchedRows: number;
  changes: {
    line: number;
    studentId: string;
    studentName: string;
    activityId: string;
    activityTitle: string;
    from: { score: number | null; excused: boolean } | null;
    to: { score: number | null; excused: boolean };
  }[];
  unchanged: number;
  errors: { line: number; column: string | null; message: string }[];
}

// ── attendance ─────────────────────────────────────────────────────────────

export type AttendanceStatus = "present" | "late" | "absent" | "excused";
export type AttendanceMethod = "self" | "qr" | "teacher" | "auto";

export interface AttendanceSession {
  id: string;
  courseId: string;
  title: string | null;
  openedBy: string | null;
  openedAt: string;
  closesAt: string;
  /** null while the session is open. */
  closedAt: string | null;
  isOpen: boolean;
  /** Staff only; never sent to students. null when no code is required. */
  checkInCode: string | null;
  requiresCode: boolean;
  lateAfterMinutes: number | null;
  /** Present when the teacher asked for a location check. */
  location: { latitude: number; longitude: number; radiusM: number } | null;
  counts: { present: number; late: number; absent: number; excused: number; pending: number };
}

export interface AttendanceRosterEntry {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  hasAccount: boolean;
  /** null while the session is open and the student has not checked in. */
  status: AttendanceStatus | null;
  method: AttendanceMethod | null;
  checkedInAt: string | null;
  distanceM: number | null;
  note: string | null;
}

export interface AttendanceSessionDetail extends AttendanceSession {
  roster: AttendanceRosterEntry[];
}

export interface AttendanceStudentSummary {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** (present + late) / (sessions - excused), 0-100; null with no sessions. */
  rate: number | null;
}

export interface AttendanceCourseSummary {
  sessionCount: number;
  students: AttendanceStudentSummary[];
}

/** Live events on the staff session stream. */
export type AttendanceStaffEvent =
  | { type: "attendance.record"; data: AttendanceRosterEntry }
  | { type: "attendance.closed"; data: AttendanceSession };

/** What a student sees of an open session: no code, no teacher location. */
export interface PortalOpenAttendance {
  sessionId: string;
  courseId: string;
  courseName: string;
  title: string | null;
  openedAt: string;
  closesAt: string;
  requiresCode: boolean;
  requiresLocation: boolean;
  /** The student's own record if they have already checked in. */
  myStatus: AttendanceStatus | null;
}

export interface PortalAttendanceRecord {
  sessionId: string;
  title: string | null;
  openedAt: string;
  status: AttendanceStatus | null;
  checkedInAt: string | null;
}

export interface PortalCourseAttendance {
  summary: Omit<AttendanceStudentSummary, "studentId" | "firstName" | "lastName">;
  records: PortalAttendanceRecord[];
}

/** Live events on the student portal stream. */
export type PortalEvent =
  | { type: "attendance.opened"; data: PortalOpenAttendance }
  | { type: "attendance.closed"; data: { sessionId: string; courseId: string } };

/** GET /courses/:courseId/attendance/sessions/:sessionId/qr - fetch again at rotatesAt. */
export interface AttendanceQrFrame {
  token: string;
  /** Encode this in the QR: opens /portal/attendance/scan?s=<session>&t=<token>. */
  url: string;
  rotatesAt: string;
  windowMs: number;
}

/** One dated activity on a calendar (`GET /calendar`). */
export interface CalendarItem {
  activityId: string;
  courseId: string;
  courseName: string;
  courseCode: string | null;
  title: string;
  kind: ActivityKind;
  /** Staff calendars include drafts; a student's never does. */
  status: ActivityStatus;
  points: number;
  dueAt: string;
}

/** A student's calendar item (`GET /portal/me/calendar`). */
export interface PortalCalendarItem extends CalendarItem {
  submission: {
    status: SubmissionStatus;
    /** Only once graded. */
    score: number | null;
    excused: boolean;
    submittedAt: string | null;
  } | null;
}

export type CourseNotificationKind = "activity_published" | "announcement";

/** A notice in the portal bell (`GET /portal/me/notifications`). */
export interface CourseNotification {
  id: string;
  kind: CourseNotificationKind;
  courseId: string;
  courseName: string | null;
  activityId: string | null;
  announcementId: string | null;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}
