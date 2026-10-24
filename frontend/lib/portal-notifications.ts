import { signal } from "@preact/signals-react";
import { api } from "@/lib/api";
import type { CourseNotification } from "@/lib/courses/types";

/** Unread course notices for the signed-in student (the portal bell). */
export const unreadCourseNotices = signal(0);

export async function refreshCourseNoticeUnread() {
  try {
    const { count } = await api<{ count: number }>(
      "/portal/me/notifications/unread-count",
    );
    unreadCourseNotices.value = count;
  } catch {
    // Non-fatal: leave the badge as-is if the count can't be fetched.
  }
}

export function listCourseNotices(limit = 20) {
  return api<CourseNotification[]>(`/portal/me/notifications?limit=${limit}`);
}

export async function markCourseNoticesRead(ids: string[]) {
  if (ids.length === 0) return;
  await api("/portal/me/notifications/read", {
    method: "POST",
    body: { ids },
  });
  unreadCourseNotices.value = Math.max(0, unreadCourseNotices.value - ids.length);
}

export async function markAllCourseNoticesRead() {
  await api("/portal/me/notifications/read-all", { method: "POST" });
  unreadCourseNotices.value = 0;
}

/** Where a notice opens in the portal. */
export function courseNoticeHref(n: CourseNotification): string {
  if (n.activityId) return `/portal/work/${n.activityId}`;
  if (n.kind === "announcement") {
    return `/portal/courses/${n.courseId}/announcements`;
  }
  return `/portal/courses/${n.courseId}`;
}
