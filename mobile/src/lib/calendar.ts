/**
 * Due dates and course notices for a student. Same shapes as the web
 * portal's, from /portal/me/calendar and /portal/me/notifications.
 */
import type { WorkKind } from "@/lib/work";

export interface PortalCalendarItem {
  activityId: string;
  courseId: string;
  courseName: string;
  courseCode: string | null;
  title: string;
  kind: WorkKind;
  status: "published" | "closed";
  points: number;
  dueAt: string;
  submission: {
    status: "draft" | "submitted" | "graded";
    score: number | null;
    excused: boolean;
    submittedAt: string | null;
  } | null;
}

export type CourseNotificationKind =
  | "activity_published"
  | "announcement"
  | "discussion_topic"
  | "discussion_reply";

export interface CourseNotification {
  id: string;
  kind: CourseNotificationKind;
  courseId: string;
  courseName: string | null;
  activityId: string | null;
  announcementId: string | null;
  /** Set on discussion notices; absent on older servers. */
  topicId?: string | null;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Days ahead the agenda reads. */
export const AGENDA_DAYS = 60;

/** Group items by the viewer's local day, in order. */
export function groupByDay(
  items: PortalCalendarItem[],
): { key: string; date: Date; items: PortalCalendarItem[] }[] {
  const groups = new Map<
    string,
    { key: string; date: Date; items: PortalCalendarItem[] }
  >();
  for (const item of items) {
    const d = new Date(item.dueAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        items: [],
      };
      groups.set(key, g);
    }
    g.items.push(item);
  }
  return [...groups.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** "Today", "Tomorrow", or "Mon 3 Nov". */
export function dayHeading(date: Date): string {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((date.getTime() - start.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** A short label for a notice's kind, for lists and screen readers. */
export function noticeKindLabel(kind: string | undefined): string {
  switch (kind) {
    case "activity_published":
      return "New work";
    case "announcement":
      return "Announcement";
    case "discussion_topic":
      return "New discussion";
    case "discussion_reply":
      return "Discussion reply";
    default:
      return "Notice";
  }
}

export function isDiscussionNotice(n: {
  type?: string;
  kind?: string;
  topicId?: string | null;
}): boolean {
  return (
    !!n.topicId ||
    n.type === "course.discussion" ||
    n.kind === "discussion_topic" ||
    n.kind === "discussion_reply"
  );
}

/**
 * Where a course notice (or the data of a tapped push) opens. A discussion
 * opens its topic - on the student or staff screen, by who is signed in -
 * new work opens the work screen, and an announcement opens its course on
 * the Announcements section. Staff only get discussion notices; anything
 * else for them has nowhere to go.
 */
export function noticeHref(
  n: {
    type?: string;
    kind?: string;
    activityId?: string | null;
    courseId?: string | null;
    topicId?: string | null;
  },
  audience: "student" | "staff" = "student",
): string | null {
  const courseBase = n.courseId
    ? audience === "student"
      ? `/course/${n.courseId}`
      : `/teaching/${n.courseId}`
    : null;
  if (isDiscussionNotice(n)) {
    if (!courseBase) return null;
    return n.topicId
      ? `${courseBase}/discussion/${n.topicId}`
      : `${courseBase}?tab=discussions`;
  }
  if (audience === "staff") return null;
  if (n.activityId) return `/work/${n.activityId}`;
  if (courseBase) return `${courseBase}?tab=announcements`;
  return null;
}
