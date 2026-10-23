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

export interface CourseNotification {
  id: string;
  kind: "activity_published" | "announcement";
  courseId: string;
  courseName: string | null;
  activityId: string | null;
  announcementId: string | null;
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

/**
 * Where a course notice opens. Mobile has no course home yet, so an
 * announcement opens the course's grades screen, the course view it has.
 */
export function noticeHref(n: {
  type?: string;
  activityId?: string | null;
  courseId?: string | null;
}): string | null {
  if (n.activityId) return `/work/${n.activityId}`;
  if (n.courseId) return `/grades/${n.courseId}`;
  return null;
}
