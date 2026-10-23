/**
 * Course content as the API sends it to both students (/portal/me/courses/...)
 * and staff (/courses/...). Mirrors frontend/lib/courses/types.ts and
 * frontend/lib/courses/discussions.ts so both clients read the same shapes.
 */
import type { Href } from "expo-router";
import type { WorkKind } from "@/lib/work";
import type { CourseGrade } from "@/lib/grades";

// ── modules and pages ─────────────────────────────────────────────────────

export type ModuleItemType = "header" | "page" | "activity" | "file" | "link";

export interface ModuleItem {
  id: string;
  moduleId: string;
  position: number;
  itemType: ModuleItemType;
  title: string;
  pageId: string | null;
  activityId: string | null;
  fileId: string | null;
  url: string | null;
  indent: number;
  isPublished: boolean;
  activity?: {
    kind: WorkKind;
    points: number;
    dueAt: string | null;
    status: "draft" | "published" | "closed";
  } | null;
  file?: { name?: string | null; contentType?: string | null } | null;
}

export interface CourseModule {
  id: string;
  courseId: string;
  title: string;
  position: number;
  isPublished: boolean;
  items: ModuleItem[];
}

export interface CoursePage {
  id: string;
  courseId: string;
  title: string;
  isPublished: boolean;
  updatedAt: string | null;
  body: string | null;
}

// ── announcements ─────────────────────────────────────────────────────────

export interface CourseAnnouncement {
  id: string;
  course_id: string;
  /** Staff list only. */
  author_user_profile_id?: string | null;
  title: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  author: {
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  } | null;
}

export function announcementAuthor(a: CourseAnnouncement): string {
  return (
    [a.author?.first_name, a.author?.last_name].filter(Boolean).join(" ") ||
    "Course staff"
  );
}

// ── discussions ───────────────────────────────────────────────────────────

export interface DiscussionAuthor {
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  isStaff: boolean;
}

export interface DiscussionTopicSummary {
  id: string;
  courseId: string;
  title: string;
  isPinned: boolean;
  isLocked: boolean;
  isPublished: boolean;
  requireInitialPost: boolean;
  author: DiscussionAuthor | null;
  isMine: boolean;
  canEdit: boolean;
  lastReplyAt: string | null;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  replyCount: number;
  unreadCount: number;
  isRead: boolean;
}

export interface DiscussionList {
  studentsCanCreateTopics: boolean;
  canCreateTopics: boolean;
  topics: DiscussionTopicSummary[];
}

export interface DiscussionReply {
  id: string;
  parentId: string | null;
  body: string;
  /** A removed post kept as a placeholder because others answered it. */
  isDeleted: boolean;
  author: DiscussionAuthor | null;
  isMine: boolean;
  canEdit: boolean;
  isNew: boolean;
  editedAt: string | null;
  createdAt: string;
  replies: DiscussionReply[];
}

export interface DiscussionTopic
  extends Omit<DiscussionTopicSummary, "unreadCount" | "isRead"> {
  body: string;
  /** Students post before they see other replies. */
  mustPostFirst: boolean;
  canReply: boolean;
  replies: DiscussionReply[];
}

export function authorName(a: DiscussionAuthor | null): string {
  if (!a) return "Former member";
  return [a.firstName, a.lastName].filter(Boolean).join(" ") || "Unknown";
}

export function initials(first?: string | null, last?: string | null): string {
  return (
    [first?.[0], last?.[0]].filter(Boolean).join("").toUpperCase() || "?"
  );
}

// ── rubrics ───────────────────────────────────────────────────────────────

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
  pointsPossible: number;
  criteria: RubricCriterion[];
  assessed: boolean;
  updatedAt: string | null;
}

export interface RubricAssessment {
  criterionId: string;
  ratingId: string | null;
  points: number;
  comment: string | null;
}

/** GET /activities/:id/rubric */
export interface ActivityRubric {
  rubric: Rubric | null;
  /** Keyed by student id. */
  assessments: Record<string, RubricAssessment[]>;
}

// ── staff ─────────────────────────────────────────────────────────────────

export type CourseRole = "admin" | "teacher" | "ta";

/** GET /courses and /courses/:id */
export interface StaffCourse {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: "draft" | "published" | "archived";
  role: CourseRole | null;
  studentCount?: number;
}

export function canManage(role: CourseRole | null | undefined): boolean {
  return role === "admin" || role === "teacher";
}

/** GET /courses/:id/people */
export interface CoursePeople {
  staff: {
    userProfileId: string;
    role: "teacher" | "ta";
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    avatarUrl: string | null;
  }[];
  students: {
    studentId: string;
    status: string;
    enrolledAt: string | null;
    firstName: string | null;
    lastName: string | null;
    hasAccount: boolean;
  }[];
}

/** GET /courses/:id/activities */
export interface StaffActivity {
  id: string;
  courseId: string;
  assignmentGroupId: string | null;
  kind: WorkKind;
  title: string;
  instructions: string | null;
  points: number;
  dueAt: string | null;
  status: "draft" | "published" | "closed";
  allowFile: boolean;
  allowText: boolean;
  maxAttempts: number;
  rubricId: string | null;
}

/** GET /activities/:id/submissions - one roster row. */
export interface TeacherSubmissionRow {
  studentId: string;
  name: string;
  enrollmentStatus: string;
  submission: {
    id: string;
    status: "draft" | "submitted" | "graded";
    textBody: string | null;
    fileId: string | null;
    fileName: string | null;
    score: number | null;
    feedback: string | null;
    excused: boolean;
    excusedReason: string | null;
    submittedAt: string | null;
    gradedAt: string | null;
    attemptCount: number;
  } | null;
}

export interface GradebookCell {
  score: number | null;
  status: "draft" | "submitted" | "graded";
  excused: boolean;
  submittedAt: string | null;
  dropped: boolean;
}

/** GET /courses/:id/gradebook */
export interface Gradebook {
  groups: {
    id: string;
    name: string;
    weight: number | null;
    position: number;
  }[];
  activities: StaffActivity[];
  students: {
    studentId: string;
    firstName: string | null;
    lastName: string | null;
    status: string;
    cells: Record<string, GradebookCell>;
    grade: CourseGrade;
  }[];
}

// ── routes ────────────────────────────────────────────────────────────────

export type CourseTab =
  | "home"
  | "modules"
  | "work"
  | "grades"
  | "announcements"
  | "discussions"
  | "attendance";

/**
 * Expo's typed-route union is regenerated by the dev server, so new routes
 * are built as strings and cast here once.
 */
export const href = (path: string) => path as Href;

export const studentCourseHref = (courseId: string, tab?: CourseTab) =>
  href(`/course/${courseId}${tab ? `?tab=${tab}` : ""}`);

export const staffCourseHref = (courseId: string, tab?: string) =>
  href(`/teaching/${courseId}${tab ? `?tab=${tab}` : ""}`);

/** Relative time for posts: "just now", "5m", "3h", "2d", then a date. */
export function timeAgo(value: string | null | undefined): string {
  if (!value) return "";
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
